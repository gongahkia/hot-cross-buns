import Foundation

enum DeepLinkBuilder {
    static func documentURL(id: String, revision: String? = nil) -> URL {
        var components = base(host: "document")
        components.percentEncodedPath = "/" + segment(id)
        if let revision {
            components.queryItems = [URLQueryItem(name: "revision", value: revision)]
        }
        return components.url!
    }

    static func driveURL(folderId: String? = nil) -> URL {
        var components = base(host: "drive")
        if let folderId {
            components.percentEncodedPath = "/" + segment(folderId)
        }
        return components.url!
    }

    static func paneURL(_ pane: AppSession.Pane) -> URL {
        var components = base(host: "pane")
        components.percentEncodedPath = "/" + pane.deepLinkName
        return components.url!
    }

    static func paletteURL(query: String? = nil) -> URL {
        var components = base(host: "palette")
        if let query, !query.isEmpty {
            components.queryItems = [URLQueryItem(name: "q", value: query)]
        }
        return components.url!
    }

    static func commandURL(_ id: String) -> URL {
        var components = base(host: "command")
        components.percentEncodedPath = "/" + segment(id)
        return components.url!
    }

    static func newDraftURL(title: String? = nil, body: String? = nil) -> URL {
        var components = base(host: "new")
        var items: [URLQueryItem] = []
        if let title {
            items.append(URLQueryItem(name: "title", value: title))
        }
        if let body {
            items.append(URLQueryItem(name: "body", value: body))
        }
        if !items.isEmpty {
            components.queryItems = items
        }
        return components.url!
    }

    static func settingsURL(section: String? = nil) -> URL {
        var components = base(host: "settings")
        if let section {
            components.percentEncodedPath = "/" + segment(section)
        }
        return components.url!
    }

    private static func base(host: String) -> URLComponents {
        var components = URLComponents()
        components.scheme = DeepLinkRouter.scheme
        components.host = host
        return components
    }

    private static func segment(_ value: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/?#[]@!$&'()*+,;=%")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }
}
