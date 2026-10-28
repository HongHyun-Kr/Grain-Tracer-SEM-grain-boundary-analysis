// Grain Tracer — macOS shell
// A native window hosting the bundled web UI (WKWebView). Native code handles only what a page cannot:
// file open/save panels, Finder "Open With", and the menu bar. All analysis runs in the page.
// Build: ./build.sh  (Command Line Tools only, no Xcode project)

import Cocoa
import WebKit

@main
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var web: WKWebView!
    private var pageReady = false
    private var pendingURLs: [URL] = []

    // MARK: entry point

    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) { app.run() }   // NSApplication.delegate is weak
    }

    // MARK: launch

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "save")

        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1440, height: 900), configuration: config)
        web.uiDelegate = self
        web.navigationDelegate = self

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Grain Tracer"
        window.minSize = NSSize(width: 1000, height: 660)
        window.contentView = web
        window.setFrameAutosaveName("GrainTracerMainWindow")
        if !window.setFrameUsingName("GrainTracerMainWindow") { window.center() }
        window.makeKeyAndOrderFront(nil)

        if let page = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") {
            web.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // MARK: open files (Finder "Open With", drop on Dock icon, File ▸ Open)

    func application(_ application: NSApplication, open urls: [URL]) {
        if pageReady { send(urls) } else { pendingURLs.append(contentsOf: urls) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageReady = true
        if !pendingURLs.isEmpty { send(pendingURLs); pendingURLs.removeAll() }
    }

    /// Passes files to the page as base64. A Hitachi sidecar .txt with the same name is attached automatically.
    private func send(_ urls: [URL]) {
        var all = urls
        for u in urls where ["tif", "tiff"].contains(u.pathExtension.lowercased()) {
            let txt = u.deletingPathExtension().appendingPathExtension("txt")
            if FileManager.default.fileExists(atPath: txt.path) && !all.contains(txt) { all.append(txt) }
        }
        var items: [[String: String]] = []
        for u in all {
            if let data = try? Data(contentsOf: u) {
                items.append(["name": u.lastPathComponent, "b64": data.base64EncodedString()])
            }
        }
        guard !items.isEmpty,
              let json = try? JSONSerialization.data(withJSONObject: items),
              let arg = String(data: json, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.__gtOpen(\(arg))", completionHandler: nil)
    }

    @objc private func openDocument(_ sender: Any?) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.message = "Choose SEM images (TIF, PNG, JPG) and optional Hitachi .txt files."
        if panel.runModal() == .OK { send(panel.urls) }
    }

    // <input type="file"> inside the page
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        completionHandler(panel.runModal() == .OK ? panel.urls : nil)
    }

    // MARK: save (page posts {name, data: base64})

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "save",
              let body = message.body as? [String: Any],
              let name = body["name"] as? String,
              let b64 = body["data"] as? String,
              let data = Data(base64Encoded: b64) else { return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = name
        panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do { try data.write(to: url) } catch { NSAlert(error: error).runModal() }
    }

    // MARK: menu

    private func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Grain Tracer", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Grain Tracer", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let others = appMenu.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        others.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Grain Tracer", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        let fileItem = NSMenuItem()
        let fileMenu = NSMenu(title: "File")
        let open = fileMenu.addItem(withTitle: "Open Image…", action: #selector(openDocument(_:)), keyEquivalent: "o")
        open.target = self
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileItem.submenu = fileMenu
        main.addItem(fileItem)

        // Text editing shortcuts for input fields. Undo is left to the page (⌘Z undoes boundary edits).
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        main.addItem(editItem)

        let viewItem = NSMenuItem()
        let viewMenu = NSMenu(title: "View")
        let fs = viewMenu.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fs.keyEquivalentModifierMask = [.command, .control]
        viewItem.submenu = viewMenu
        main.addItem(viewItem)

        let winItem = NSMenuItem()
        let winMenu = NSMenu(title: "Window")
        winMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        winMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        winItem.submenu = winMenu
        main.addItem(winItem)

        NSApp.mainMenu = main
        NSApp.windowsMenu = winMenu
    }
}
