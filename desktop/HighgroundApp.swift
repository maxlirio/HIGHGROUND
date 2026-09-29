// HIGHGROUND — native macOS shell. A single window running the game in WebKit (Safari's engine,
// Metal-backed WebGL2). It serves the LIVE project folder (~/Developer/HIGHGROUND) from a tiny
// loopback HTTP server built in here, so the app always runs the latest build: Cmd+R reloads.
import Cocoa
import WebKit
import Network

let projectDir: URL = {
    let live = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Developer/HIGHGROUND")
    if FileManager.default.fileExists(atPath: live.appendingPathComponent("index.html").path) { return live }
    return Bundle.main.resourceURL!.appendingPathComponent("game")
}()

// ---------------------------------------------------------------- minimal static file server
final class FileServer {
    let listener: NWListener
    var port: UInt16 = 0
    init() throws {
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
        listener = try NWListener(using: params)
    }
    func start(ready: @escaping (UInt16) -> Void) {
        listener.stateUpdateHandler = { [weak self] st in
            if case .ready = st, let p = self?.listener.port?.rawValue { self?.port = p; DispatchQueue.main.async { ready(p) } }
        }
        listener.newConnectionHandler = { conn in
            conn.start(queue: .global(qos: .userInitiated))
            FileServer.serve(conn)
        }
        listener.start(queue: .global(qos: .userInitiated))
    }
    static let mime: [String: String] = [
        "html": "text/html; charset=utf-8", "js": "text/javascript", "mjs": "text/javascript", "css": "text/css",
        "json": "application/json", "glb": "model/gltf-binary", "png": "image/png", "jpg": "image/jpeg",
        "svg": "image/svg+xml", "wasm": "application/wasm",
    ]
    static func serve(_ conn: NWConnection) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, done, err in
            guard let data = data, let req = String(data: data, encoding: .utf8),
                  let line = req.split(separator: "\r\n").first else { conn.cancel(); return }
            let parts = line.split(separator: " ")
            var path = parts.count > 1 ? String(parts[1]) : "/"
            if let q = path.firstIndex(of: "?") { path = String(path[..<q]) }
            path = path.removingPercentEncoding ?? path
            if path == "/" || path.isEmpty { path = "/index.html" }
            let file = projectDir.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
            var head: String, body = Data()
            if file.path.hasPrefix(projectDir.standardizedFileURL.path), let d = try? Data(contentsOf: file) {
                body = d
                let type = mime[file.pathExtension.lowercased()] ?? "application/octet-stream"
                head = "HTTP/1.1 200 OK\r\nContent-Type: \(type)\r\nContent-Length: \(d.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
            } else {
                head = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            }
            var out = Data(head.utf8); out.append(body)
            conn.send(content: out, completion: .contentProcessed { _ in conn.cancel() })
        }
    }
}

// A game window: keys the page doesn't consume must not fall off the end of the responder chain,
// or macOS plays the "can't do that" alert sound on every WASD press.
final class GameWindow: NSWindow {
    override func noResponder(for eventSelector: Selector) {
        if eventSelector == #selector(NSResponder.keyDown(with:)) { return }
        super.noResponder(for: eventSelector)
    }
}
final class GameWebView: WKWebView {
    override func keyDown(with event: NSEvent) { super.keyDown(with: event) }
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        // let menu shortcuts (Cmd+R, Cmd+Q…) work; plain keys belong to the game
        if event.modifierFlags.contains(.command) { return super.performKeyEquivalent(with: event) }
        return false
    }
}

// ---------------------------------------------------------------- app
final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var server: FileServer!

    func applicationDidFinishLaunching(_ note: Notification) {
        let cfg = WKWebViewConfiguration()
        cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")
        cfg.websiteDataStore = .nonPersistent() // never serve a stale cached build
        web = GameWebView(frame: .zero, configuration: cfg)
        web.uiDelegate = self
        web.setValue(false, forKey: "drawsBackground")

        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1600, height: 1000)
        window = GameWindow(contentRect: screen, styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "HIGHGROUND"
        window.backgroundColor = NSColor(red: 0.05, green: 0.047, blue: 0.04, alpha: 1)
        window.collectionBehavior = [.fullScreenPrimary]
        window.contentView = web
        window.makeKeyAndOrderFront(nil)
        window.setFrame(screen, display: true)

        server = try! FileServer()
        server.start { [weak self] port in
            self?.web.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/")!))
        }
        buildMenu()
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }

    @objc func reload() { web.reloadFromOrigin() }
    @objc func progress() { NSWorkspace.shared.open(URL(string: "http://localhost:8321/status/")!) }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Hide HIGHGROUND", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit HIGHGROUND", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let gameItem = NSMenuItem(); main.addItem(gameItem)
        let game = NSMenu(title: "Game")
        game.addItem(withTitle: "Reload latest build", action: #selector(reload), keyEquivalent: "r").target = self
        game.addItem(withTitle: "Progress page", action: #selector(progress), keyEquivalent: "p").target = self
        game.addItem(.separator())
        let fs = game.addItem(withTitle: "Toggle Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fs.keyEquivalentModifierMask = [.command, .control]
        gameItem.submenu = game
        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
