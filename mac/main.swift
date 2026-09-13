// Menu bar launcher for Fantasy Side by Side.
// Runs the bundled Node server as a child process; offers Open / Settings / Quit.
import Cocoa

let port = 5050
let appName = "Fantasy Side by Side"

final class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var server: Process?

    func applicationDidFinishLaunching(_ note: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "🏈"
        statusItem.button?.toolTip = appName

        let menu = NSMenu()
        menu.addItem(withTitle: "Open Dashboard", action: #selector(openDashboard), keyEquivalent: "o")
        menu.addItem(withTitle: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit \(appName)", action: #selector(quit), keyEquivalent: "q")
        statusItem.menu = menu

        startServer()
    }

    func startServer() {
        guard let res = Bundle.main.resourceURL else { return }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(appName)
        try? FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)

        let p = Process()
        p.executableURL = res.appendingPathComponent("node/bin/node")
        p.arguments = [res.appendingPathComponent("app/server.js").path]
        p.currentDirectoryURL = res.appendingPathComponent("app")
        var env = ProcessInfo.processInfo.environment
        env["FSBS_DATA_DIR"] = support.path
        env["PORT"] = String(port)
        env["FSBS_PARENT_WATCH"] = "1"   // node exits on its own if this process dies
        p.environment = env
        p.terminationHandler = { proc in
            DispatchQueue.main.async {
                if proc.terminationStatus != 0 && proc.terminationReason == .exit {
                    let a = NSAlert()
                    a.messageText = "\(appName) stopped"
                    a.informativeText = "The local server exited (code \(proc.terminationStatus)). Is another copy already running on port \(port)?"
                    a.runModal()
                }
                NSApp.terminate(nil)
            }
        }
        do { try p.run(); server = p } catch {
            let a = NSAlert(); a.messageText = "Could not start \(appName)"; a.informativeText = error.localizedDescription; a.runModal()
            NSApp.terminate(nil)
        }
    }

    @objc func openDashboard() { NSWorkspace.shared.open(URL(string: "http://localhost:\(port)/")!) }
    @objc func openSettings()  { NSWorkspace.shared.open(URL(string: "http://localhost:\(port)/setup")!) }
    @objc func quit() { NSApp.terminate(nil) }

    func applicationWillTerminate(_ note: Notification) {
        if let s = server, s.isRunning { s.terminationHandler = nil; s.terminate() }
    }
}

// A plain SIGTERM (Activity Monitor, `kill`) would skip applicationWillTerminate and orphan node.
signal(SIGTERM, SIG_IGN)
let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
sigterm.setEventHandler { NSApp.terminate(nil) }
sigterm.resume()

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)   // menu bar only, no Dock icon
app.run()
