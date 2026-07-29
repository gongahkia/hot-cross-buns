local Rng = require("src.rng")

local Noise = {}

local skew2D = 0.366025403784439
local unskew2D = -0.21132486540518713
local radius2D = 0.5
local normalizer2D = 0.01001634121365712
local gradients2D = {
    { 0.38268343236509 / normalizer2D, 0.923879532511287 / normalizer2D },
    { 0.923879532511287 / normalizer2D, 0.38268343236509 / normalizer2D },
    { 0.923879532511287 / normalizer2D, -0.38268343236509 / normalizer2D },
    { 0.38268343236509 / normalizer2D, -0.923879532511287 / normalizer2D },
    { -0.38268343236509 / normalizer2D, -0.923879532511287 / normalizer2D },
    { -0.923879532511287 / normalizer2D, -0.38268343236509 / normalizer2D },
    { -0.923879532511287 / normalizer2D, 0.38268343236509 / normalizer2D },
    { -0.38268343236509 / normalizer2D, 0.923879532511287 / normalizer2D },
    { 0.130526192220052 / normalizer2D, 0.99144486137381 / normalizer2D },
    { 0.608761429008721 / normalizer2D, 0.793353340291235 / normalizer2D },
    { 0.793353340291235 / normalizer2D, 0.608761429008721 / normalizer2D },
    { 0.99144486137381 / normalizer2D, 0.130526192220051 / normalizer2D },
    { 0.99144486137381 / normalizer2D, -0.130526192220051 / normalizer2D },
    { 0.793353340291235 / normalizer2D, -0.60876142900872 / normalizer2D },
    { 0.608761429008721 / normalizer2D, -0.793353340291235 / normalizer2D },
    { 0.130526192220052 / normalizer2D, -0.99144486137381 / normalizer2D },
    { -0.130526192220052 / normalizer2D, -0.99144486137381 / normalizer2D },
    { -0.608761429008721 / normalizer2D, -0.793353340291235 / normalizer2D },
    { -0.793353340291235 / normalizer2D, -0.608761429008721 / normalizer2D },
    { -0.99144486137381 / normalizer2D, -0.130526192220052 / normalizer2D },
    { -0.99144486137381 / normalizer2D, 0.130526192220051 / normalizer2D },
    { -0.793353340291235 / normalizer2D, 0.608761429008721 / normalizer2D },
    { -0.608761429008721 / normalizer2D, 0.793353340291235 / normalizer2D },
    { -0.130526192220052 / normalizer2D, 0.99144486137381 / normalizer2D },
}

local gradientCount = #gradients2D

local function floor(value)
    return math.floor(value)
end

local function clamp(value, minValue, maxValue)
    return math.max(minValue, math.min(maxValue, value))
end

local function grad(seed, x, y, salt, dx, dy)
    local gradient = gradients2D[(Rng.hash(seed, x, y, salt or 0) % gradientCount) + 1]
    return gradient[1] * dx + gradient[2] * dy
end

local function contribution(seed, x, y, salt, dx, dy)
    local a = radius2D - dx * dx - dy * dy
    if a <= 0 then return 0 end
    local aa = a * a
    return aa * aa * grad(seed, x, y, salt, dx, dy)
end

function Noise.value(seed, x, y, salt)
    local s = (x + y) * skew2D
    local xs, ys = x + s, y + s
    local xsb, ysb = floor(xs), floor(ys)
    local xi, yi = xs - xsb, ys - ysb
    local t = (xi + yi) * unskew2D
    local dx0, dy0 = xi + t, yi + t
    local value = contribution(seed, xsb, ysb, salt, dx0, dy0)
    local a1 = 2 * (1 + 2 * unskew2D) * (1 / unskew2D + 2) * t + (-2 * (1 + 2 * unskew2D) * (1 + 2 * unskew2D) + (radius2D - dx0 * dx0 - dy0 * dy0))
    if a1 > 0 then
        local dx1, dy1 = dx0 - (1 + 2 * unskew2D), dy0 - (1 + 2 * unskew2D)
        local aa = a1 * a1
        value = value + aa * aa * grad(seed, xsb + 1, ysb + 1, salt, dx1, dy1)
    end
    if dy0 > dx0 then
        value = value + contribution(seed, xsb, ysb + 1, salt, dx0 - unskew2D, dy0 - (unskew2D + 1))
    else
        value = value + contribution(seed, xsb + 1, ysb, salt, dx0 - (unskew2D + 1), dy0 - unskew2D)
    end
    return clamp(value * 0.5 + 0.5, 0, 1)
end

function Noise.fbm(seed, x, y, options)
    options = options or {}
    local octaves = options.octaves or 5
    local frequency = options.frequency or 0.01
    local lacunarity = options.lacunarity or 2
    local gain = options.gain or 0.5
    local amplitude = 1
    local total = 0
    local norm = 0
    for octave = 1, octaves do
        total = total + Noise.value(seed + octave * 101, x * frequency, y * frequency, (options.salt or 0) + octave * 17) * amplitude
        norm = norm + amplitude
        frequency = frequency * lacunarity
        amplitude = amplitude * gain
    end
    return norm > 0 and total / norm or 0
end

function Noise.ridge(seed, x, y, options)
    return 1 - math.abs(Noise.fbm(seed, x, y, options) * 2 - 1)
end

function Noise.warp(seed, x, y, options)
    options = options or {}
    local amount = options.amount or 32
    local frequency = options.frequency or 0.005
    local wx = Noise.fbm(seed + 7001, x, y, { frequency = frequency, octaves = 3, salt = 41 }) * 2 - 1
    local wy = Noise.fbm(seed + 9001, x, y, { frequency = frequency, octaves = 3, salt = 53 }) * 2 - 1
    return x + wx * amount, y + wy * amount
end

return Noise
