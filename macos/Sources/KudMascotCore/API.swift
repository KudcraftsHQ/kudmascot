import Foundation

public struct MacIcon: Codable, Hashable, Sendable {
    public let bundleId: String
    public let drawable: String
    public let version: String
    public let url: String
}

public struct MacStatus: Codable, Hashable, Sendable {
    public let status: String
    public let suggested: Bool
}

public struct MacRequest: Codable, Sendable {
    public let bundleId: String
    public let name: String
    public let icon: String?   // base64 PNG
    public init(bundleId: String, name: String, icon: String?) { self.bundleId = bundleId; self.name = name; self.icon = icon }
}

public enum APIError: Error, CustomStringConvertible {
    case notConfigured
    case unauthorized
    case http(Int, String)

    public var description: String {
        switch self {
        case .notConfigured: return "Set the server URL and token in Settings"
        case .unauthorized: return "The server refused the token"
        case .http(let code, let body): return "HTTP \(code): \(body.prefix(200))"
        }
    }
}

/// The kudmascot server's Mac API (bearer token).
public struct API: Sendable {
    public let base: URL
    public let token: String

    public init?(base: String, token: String) {
        guard !token.isEmpty, let url = URL(string: base.trimmingCharacters(in: .whitespacesAndNewlines)), url.scheme != nil else { return nil }
        self.base = url
        self.token = token
    }

    func make(_ path: String, method: String = "GET", body: Data? = nil) -> URLRequest {
        var r = URLRequest(url: URL(string: path, relativeTo: base)!.absoluteURL)
        r.httpMethod = method
        r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        r.timeoutInterval = 30
        if let body { r.httpBody = body; r.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        return r
    }

    func send(_ r: URLRequest) async throws -> Data {
        let (data, resp) = try await URLSession.shared.data(for: r)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(code) else { throw APIError.http(code, String(decoding: data, as: UTF8.self)) }
        return data
    }

    public func icons() async throws -> [MacIcon] {
        struct R: Codable { let icons: [MacIcon] }
        return try JSONDecoder().decode(R.self, from: try await send(make("/api/mac/icons"))).icons
    }

    public func status() async throws -> [String: MacStatus] {
        struct R: Codable { let apps: [String: MacStatus] }
        return try JSONDecoder().decode(R.self, from: try await send(make("/api/mac/status"))).apps
    }

    public func request(_ apps: [MacRequest]) async throws {
        struct B: Codable { let platform: String; let requests: [MacRequest] }
        _ = try await send(make("/api/requests", method: "POST", body: try JSONEncoder().encode(B(platform: "mac", requests: apps))))
    }

    public func download(_ path: String) async throws -> Data {
        try await send(make(path))
    }
}
