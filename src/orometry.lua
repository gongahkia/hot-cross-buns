local Rng = require("src.rng")

local Orometry = {}

local orderFallback = { "alps", "appalachians", "himalaya", "andes", "fjordland", "basinrange" }
local cache
local defaultModifiers = { peakAmpScale = 1, ridgeFreqScale = 1, slopeBias = 0, reliefScale = 1 }

local function clamp(value, minValue, maxValue)
    if value < minValue then return minValue end
    if value > maxValue then return maxValue end
    return value
end

local function smoothstep(minValue, maxValue, value)
    local t = clamp((value - minValue) / (maxValue - minValue), 0, 1)
    return t * t * (3 - 2 * t)
end

local function floorDiv(value, divisor)
    return math.floor(value / divisor)
end

local function floorMod(value, divisor)
    return value - floorDiv(value, divisor) * divisor
end

local function copyList(values)
    local out = {}
    for index = 1, #values do out[index] = values[index] end
    return out
end

local function normalize(raw)
    local list, byId, byKey = {}, {}, {}
    local order = raw.order or orderFallback
    for index, key in ipairs(order) do
        local entry = raw[key]
        assert(entry, "missing orometry archetype: " .. tostring(key))
        local copy = {}
        for k, v in pairs(entry) do
            copy[k] = type(v) == "table" and copyList(v) or v
        end
        copy.key = key
        copy.id = tonumber(copy.id) or index
        list[#list + 1] = copy
        byId[copy.id] = copy
        byKey[key] = copy
    end
    assert(#list == 6, "orometry archetype bake should contain 6 entries")
    list.byId = byId
    list.byKey = byKey
    return list
end

function Orometry.archetypes()
    if cache then return cache end
    local ok, raw = pcall(dofile, "assets/orometry/archetypes.lua")
    assert(ok, raw)
    cache = normalize(raw)
    return cache
end

function Orometry.defaultModifiers()
    return defaultModifiers
end

local function archetypeAt(list, seed, blockX, blockY)
    local index = (Rng.hash(seed, blockX, blockY, 1091) % #list) + 1
    return list[index]
end

local function mix(a, b, t)
    return a + (b - a) * t
end

local function blended(primary, secondary, blend)
    secondary = secondary or primary
    return {
        peakAmpScale = mix(secondary.peakAmpScale or 1, primary.peakAmpScale or 1, blend),
        ridgeFreqScale = mix(secondary.ridgeFreqScale or 1, primary.ridgeFreqScale or 1, blend),
        slopeBias = mix(secondary.slopeBias or 0, primary.slopeBias or 0, blend),
        reliefScale = mix(secondary.reliefScale or 1, primary.reliefScale or 1, blend),
    }
end

function Orometry.pick(world, x, y, info)
    local list = world.orometryArchetypes or Orometry.archetypes()
    local factor = (info and info.factor) or 1
    local chunkSize = world.chunkSize or 64
    local blockChunks = world.orometryBlockChunks or 4
    local haloCells = world.orometryHaloCells or 8
    local gx = math.floor((x or 0) / factor)
    local gy = math.floor((y or 0) / factor)
    local cx = floorDiv(gx, chunkSize)
    local cy = floorDiv(gy, chunkSize)
    local blockX = floorDiv(cx, blockChunks)
    local blockY = floorDiv(cy, blockChunks)
    local primary = archetypeAt(list, world.seed, blockX, blockY)
    local blockCells = chunkSize * blockChunks
    local lx = floorMod(gx, blockCells)
    local ly = floorMod(gy, blockCells)
    local left = lx
    local right = blockCells - 1 - lx
    local top = ly
    local bottom = blockCells - 1 - ly
    local edge, dx, dy = left, -1, 0
    if right < edge then edge, dx, dy = right, 1, 0 end
    if top < edge then edge, dx, dy = top, 0, -1 end
    if bottom < edge then edge, dx, dy = bottom, 0, 1 end
    local secondary = edge < haloCells and archetypeAt(list, world.seed, blockX + dx, blockY + dy) or primary
    local blend = secondary == primary and 1 or smoothstep(0, haloCells, edge)
    return primary, primary.id, blend, blended(primary, secondary, blend)
end

return Orometry
