import Foundation
import KudMascotCore

/// CLI flags first: the admin path re-runs this binary as root through
/// `osascript … with administrator privileges` to change icons the user can't write.
///   kudmascot --apply-icon <App.app> <icon.png>
///   kudmascot --restore-icon <App.app>
///   kudmascot --apply-icons <manifest.json>     [{"app": "...", "png": "..." | null}]
@main
enum Main {
    @MainActor
    static func main() {
        let a = CommandLine.arguments
        if a.count >= 4, a[1] == "--apply-icon" {
            exit(report(IconBatch.run([IconJob(app: a[2], png: a[3])])))
        }
        if a.count >= 3, a[1] == "--restore-icon" {
            exit(report(IconBatch.run([IconJob(app: a[2], png: nil)])))
        }
        if a.count >= 3, a[1] == "--apply-icons" {
            guard let data = FileManager.default.contents(atPath: a[2]),
                  let jobs = try? JSONDecoder().decode([IconJob].self, from: data) else {
                FileHandle.standardError.write(Data("can't read manifest \(a[2])\n".utf8))
                exit(2)
            }
            exit(report(IconBatch.run(jobs)))
        }
        if a.count >= 2, a[1] == "--version" {
            print(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev")
            exit(0)
        }
        KudMascotApp.main()
    }

    static func report(_ failed: [String: String]) -> Int32 {
        for (app, err) in failed.sorted(by: { $0.key < $1.key }) {
            FileHandle.standardError.write(Data("failed \(app): \(err)\n".utf8))
        }
        return failed.isEmpty ? 0 : 1
    }
}
