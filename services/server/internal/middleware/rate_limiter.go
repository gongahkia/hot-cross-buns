package middleware

import (
	"fmt"
	"math"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
	"golang.org/x/time/rate"
)

// RateLimiterConfig configures the per-IP rate limiter.
type RateLimiterConfig struct {
	// Limit is the maximum number of requests allowed per minute.
	Limit float64
	// Burst is the maximum burst size (requests that can be made instantly).
	Burst int
}

// Preset rate limit configurations.
var (
	// AuthRateLimit restricts authentication endpoints to 5 requests per minute.
	AuthRateLimit = RateLimiterConfig{Limit: 5, Burst: 5}
	// SyncRateLimit restricts sync endpoints to 60 requests per minute.
	SyncRateLimit = RateLimiterConfig{Limit: 60, Burst: 60}
	// GeneralRateLimit restricts general endpoints to 120 requests per minute.
	GeneralRateLimit = RateLimiterConfig{Limit: 120, Burst: 120}
)

// ipLimiter holds a rate limiter and the last time it was used.
type ipLimiter struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// RateLimiterMiddleware returns an Echo middleware that enforces per-IP rate
// limiting. When the limit is exceeded it responds with HTTP 429 and a
// Retry-After header indicating how many seconds the client should wait.
func RateLimiterMiddleware(config RateLimiterConfig) echo.MiddlewareFunc {
	var limiters sync.Map // map[string]*ipLimiter

	// perSecond converts the per-minute limit to a per-second rate.
	perSecond := config.Limit / 60.0

	// Background goroutine: clean up stale entries every 10 minutes.
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			limiters.Range(func(key, value any) bool {
				entry := value.(*ipLimiter)
				if time.Since(entry.lastSeen) > 10*time.Minute {
					limiters.Delete(key)
				}
				return true
			})
		}
	}()

	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			ip := extractIP(c)

			val, _ := limiters.LoadOrStore(ip, &ipLimiter{
				limiter:  rate.NewLimiter(rate.Limit(perSecond), config.Burst),
				lastSeen: time.Now(),
			})
			entry := val.(*ipLimiter)
			entry.lastSeen = time.Now()

			if !entry.limiter.Allow() {
				// Calculate Retry-After: time until the next token is available.
				reservation := entry.limiter.Reserve()
				delay := reservation.Delay()
				reservation.Cancel()

				retryAfter := int(math.Ceil(delay.Seconds()))
				if retryAfter < 1 {
					retryAfter = 1
				}

				c.Response().Header().Set("Retry-After", fmt.Sprintf("%d", retryAfter))
				return c.JSON(http.StatusTooManyRequests, map[string]interface{}{
					"error": map[string]interface{}{
						"code":    "RATE_LIMITED",
						"message": "too many requests, please try again later",
						"details": []string{},
					},
				})
			}

			return next(c)
		}
	}
}

// extractIP returns the client IP from the request, stripping the port if present.
func extractIP(c echo.Context) string {
	ip := c.RealIP()
	// RealIP may return host:port for certain transports; strip the port.
	if host, _, err := net.SplitHostPort(ip); err == nil {
		return host
	}
	return ip
}
