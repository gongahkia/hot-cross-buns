local Rng = {}
Rng.__index = Rng

local bit = require("bit")
local bxor, rshift, tobit = bit.bxor, bit.rshift, bit.tobit
local mod = 2147483647
local u32 = 4294967296
local u32Inv = 1 / u32
local hashSeed = 374761393
local hashA = 73856093
local hashB = 19349663
local hashC = 83492791
local hashD = 26544357

local function norm(value)
    return math.floor(tonumber(value) or 0) % mod
end

local function legacyMix(h, value, salt)
    h = (h + norm(value) * salt) % mod
    h = (h * 48271 + 1) % mod
    return h
end

local function legacyHash(seed, a, b, c, d)
    local h = norm(seed or 1)
    h = legacyMix(h, a or 0, 73856093)
    h = legacyMix(h, b or 0, 19349663)
    h = legacyMix(h, c or 0, 83492791)
    h = legacyMix(h, d or 0, 26544357)
    return h
end

local function unsigned(value)
    return value < 0 and value + u32 or value
end

function Rng.hash(seed, a, b, c, d)
    local h = bxor(
        tobit((seed or 1) * hashSeed),
        tobit((a or 0) * hashA),
        tobit((b or 0) * hashB),
        tobit((c or 0) * hashC),
        tobit((d or 0) * hashD)
    )
    return bxor(h, rshift(h, 16))
end

function Rng.unitAt(seed, a, b, c, d)
    return unsigned(Rng.hash(seed, a, b, c, d)) * u32Inv
end

function Rng.signed(seed, a, b, c, d)
    return Rng.unitAt(seed, a, b, c, d) * 2 - 1
end

function Rng.new(seed)
    return setmetatable({ state = norm(seed or 1) }, Rng)
end

function Rng:next()
    self.state = (self.state * 48271 + 1) % mod
    return self.state
end

function Rng:unit()
    return self:next() / mod
end

function Rng:range(minValue, maxValue)
    return minValue + (self:next() % (maxValue - minValue + 1))
end

function Rng.benchmarkHash(options)
    options = options or {}
    local count = options.count or 1000000
    local function run(fn)
        local checksum = 0
        local started = os.clock()
        for index = 1, count do
            checksum = checksum + fn(20260625, index, -index * 3, index % 997, 17)
        end
        return { seconds = math.max(0.000001, os.clock() - started), checksum = checksum }
    end
    local legacy = run(legacyHash)
    local current = run(Rng.hash)
    return {
        count = count,
        legacy = legacy,
        current = current,
        speedup = legacy.seconds / current.seconds,
    }
end

return Rng
