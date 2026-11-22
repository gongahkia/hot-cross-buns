package localmodel

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// LocalURL canonicalizes localhost without DNS and accepts only literal loopback HTTP.
func LocalURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u == nil || u.Scheme != "http" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawPath != "" || u.Opaque != "" {
		return nil, errors.New("local endpoint must be loopback HTTP without credentials, query or fragment")
	}
	host := strings.ToLower(u.Hostname())
	if host == "localhost" || host == "localhost." {
		host = "127.0.0.1"
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return nil, errors.New("local endpoint must use a literal loopback address or localhost")
	}
	port := u.Port()
	if port != "" {
		n, e := strconv.ParseUint(port, 10, 16)
		if e != nil || n == 0 {
			return nil, errors.New("invalid local endpoint port")
		}
	}
	if port == "" {
		if strings.Contains(host, ":") {
			u.Host = "[" + host + "]"
		} else {
			u.Host = host
		}
	} else {
		u.Host = net.JoinHostPort(host, port)
	}
	return u, nil
}

// HTTPClient pins all requests to this origin, refuses redirects and bypasses proxies.
// It is also used by the separately constructed managed Chat Completions adapter.
func HTTPClient(raw string) (*http.Client, error) {
	u, err := LocalURL(raw)
	if err != nil {
		return nil, err
	}
	dialer := &net.Dialer{Timeout: 3 * time.Second, KeepAlive: 30 * time.Second}
	transport := &http.Transport{Proxy: nil, MaxResponseHeaderBytes: 64 * 1024, MaxConnsPerHost: 2, MaxIdleConns: 2, MaxIdleConnsPerHost: 2, IdleConnTimeout: 10 * time.Second, ResponseHeaderTimeout: 5 * time.Second, DisableCompression: true,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, _, e := net.SplitHostPort(address)
			if e != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
				return nil, errors.New("local transport refused destination")
			}
			return dialer.DialContext(ctx, network, address)
		},
	}
	return &http.Client{Transport: localTransport{origin: u.Host, transport: transport}, Timeout: 10 * time.Minute,
		CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("local transport refuses redirects") }}, nil
}

type localTransport struct {
	origin    string
	transport *http.Transport
}

func (t localTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Scheme != "http" || r.URL.Host != t.origin || r.URL.User != nil || r.URL.RawQuery != "" || r.URL.Fragment != "" {
		return nil, errors.New("local transport refused destination")
	}
	if r.Header.Get("Authorization") != "" || r.Header.Get("Proxy-Authorization") != "" || r.Header.Get("Cookie") != "" {
		return nil, errors.New("managed local inference does not accept credentials")
	}
	response, err := t.transport.RoundTrip(r)
	if err != nil {
		if r.Context().Err() != nil {
			return nil, r.Context().Err()
		}
		return nil, errors.New("local transport failed")
	}
	if response.StatusCode >= 300 && response.StatusCode < 400 {
		response.Body.Close()
		return nil, errors.New("local transport refuses redirects")
	}
	if response.StatusCode < 200 || response.StatusCode >= 400 {
		// Preserve structured inference failure diagnostics without retaining untrusted error bodies.
		response.Body.Close()
		response.Body = io.NopCloser(strings.NewReader(""))
		response.ContentLength = 0
		return response, nil
	}
	limit := int64(maxResponseBytes)
	if r.URL.Path == "/api/pull" {
		limit = 64 * 1024 * 1024
	}
	response.Body = &boundedBody{ReadCloser: response.Body, remaining: limit}
	return response, nil
}
func (t localTransport) CloseIdleConnections() { t.transport.CloseIdleConnections() }

type boundedBody struct {
	io.ReadCloser
	remaining int64
}

func (b *boundedBody) Read(p []byte) (int, error) {
	if b.remaining == 0 {
		var probe [1]byte
		n, err := b.ReadCloser.Read(probe[:])
		if n > 0 {
			return 0, errors.New("local response exceeds limit")
		}
		return 0, err
	}
	if int64(len(p)) > b.remaining {
		p = p[:b.remaining]
	}
	n, err := b.ReadCloser.Read(p)
	b.remaining -= int64(n)
	return n, err
}
