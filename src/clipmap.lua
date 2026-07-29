local Clipmap = {}
Clipmap.__index = Clipmap

local function clamp(value, minValue, maxValue)
    return math.max(minValue, math.min(maxValue, value))
end

local function sampleIndex(level, ix, iy)
    local half = level.halfResolution
    return (iy + half) * level.sampleSize + (ix + half) + 1
end

local function buildTiles(level)
    local tiles = {}
    local half = level.halfResolution
    local inner = level.innerHalf
    for iy = -half, half - 1 do
        for ix = -half, half - 1 do
            local cx, cy = ix + 0.5, iy + 0.5
            if inner <= 0 or math.abs(cx) >= inner or math.abs(cy) >= inner then
                tiles[#tiles + 1] = {
                    ix = ix,
                    iy = iy,
                    i00 = sampleIndex(level, ix, iy),
                    i10 = sampleIndex(level, ix + 1, iy),
                    i11 = sampleIndex(level, ix + 1, iy + 1),
                    i01 = sampleIndex(level, ix, iy + 1),
                }
            end
        end
    end
    return tiles
end

local function fillSample(level, target, index, originX, originY, ix, iy, sampleFn)
    local x = originX + ix * level.step
    local y = originY + iy * level.step
    local cell, z = sampleFn(x, y, level)
    if z == nil and type(cell) == "table" and cell.cell then
        target[index] = cell
        target[index].x = x
        target[index].y = y
        return
    end
    target[index] = { x = x, y = y, cell = cell, z = z }
end

local function fullRefill(level, originX, originY, sampleFn)
    for iy = -level.halfResolution, level.halfResolution do
        for ix = -level.halfResolution, level.halfResolution do
            local index = sampleIndex(level, ix, iy)
            fillSample(level, level.samples, index, originX, originY, ix, iy, sampleFn)
        end
    end
    level.originX = originX
    level.originY = originY
    return level.sampleCount
end

local function partialRefill(level, originX, originY, dx, dy, sampleFn)
    local filled = 0
    local half = level.halfResolution
    for iy = -half, half do
        for ix = -half, half do
            local dest = sampleIndex(level, ix, iy)
            local sourceIx = ix + dx
            local sourceIy = iy + dy
            if sourceIx >= -half and sourceIx <= half and sourceIy >= -half and sourceIy <= half then
                level.scratch[dest] = level.samples[sampleIndex(level, sourceIx, sourceIy)]
            else
                fillSample(level, level.scratch, dest, originX, originY, ix, iy, sampleFn)
                filled = filled + 1
            end
        end
    end
    level.samples, level.scratch = level.scratch, level.samples
    level.originX = originX
    level.originY = originY
    return filled
end

function Clipmap.new(options)
    options = options or {}
    local levelCount = options.levelCount or 6
    local halfResolution = options.halfResolution or 16
    local levels = {}
    for index = 1, levelCount do
        local step = (options.steps and options.steps[index]) or 2 ^ (index - 1)
        local level = {
            index = index,
            step = step,
            halfResolution = halfResolution,
            innerHalf = index == 1 and 0 or halfResolution * 0.5,
            sampleSize = halfResolution * 2 + 1,
        }
        level.sampleCount = level.sampleSize * level.sampleSize
        level.tiles = buildTiles(level)
        level.vertexCapacity = #level.tiles * 6
        levels[index] = level
    end
    for index, level in ipairs(levels) do level.hasOuterMorph = index < #levels end
    return setmetatable({
        levels = levels,
        halfResolution = halfResolution,
        levelCount = levelCount,
        lastUpdate = nil,
    }, Clipmap)
end

function Clipmap.radius(state)
    local level = state.levels[#state.levels]
    return level.halfResolution * level.step
end

function Clipmap.steps(state)
    local out = {}
    for index, level in ipairs(state.levels) do out[index] = level.step end
    return out
end

function Clipmap.sampleIndex(level, ix, iy)
    return sampleIndex(level, ix, iy)
end

function Clipmap.outerMorph(level, ix, iy)
    if not level.hasOuterMorph then return 0 end
    local edgeDistance = level.halfResolution - math.max(math.abs(ix), math.abs(iy))
    return clamp((2 - edgeDistance) / 2, 0, 1)
end

function Clipmap.heightAt(level, x, y)
    if not (level and level.samples and level.originX and level.originY) then return nil end
    local fx = (x - level.originX) / level.step + level.halfResolution
    local fy = (y - level.originY) / level.step + level.halfResolution
    if fx < 0 or fy < 0 or fx > level.sampleSize - 1 or fy > level.sampleSize - 1 then return nil end
    local ix = math.floor(clamp(fx, 0, level.sampleSize - 2))
    local iy = math.floor(clamp(fy, 0, level.sampleSize - 2))
    local tx = fx - ix
    local ty = fy - iy
    local lx = ix - level.halfResolution
    local ly = iy - level.halfResolution
    local s00 = level.samples[sampleIndex(level, lx, ly)]
    local s10 = level.samples[sampleIndex(level, lx + 1, ly)]
    local s01 = level.samples[sampleIndex(level, lx, ly + 1)]
    local s11 = level.samples[sampleIndex(level, lx + 1, ly + 1)]
    if not (s00 and s10 and s01 and s11) then return nil end
    local z0 = s00.z + (s10.z - s00.z) * tx
    local z1 = s01.z + (s11.z - s01.z) * tx
    return z0 + (z1 - z0) * ty
end

function Clipmap.update(state, x, y, sampleFn, options)
    options = options or {}
    local stats = {
        rings = #state.levels,
        radius = Clipmap.radius(state),
        steps = Clipmap.steps(state),
        refilledRings = 0,
        reusedRings = 0,
        partialRefills = 0,
        fullRefills = 0,
        samplesRefilled = 0,
        tileCapacity = 0,
        vertexCapacity = 0,
        morphBands = math.max(0, #state.levels - 1),
    }
    for _, level in ipairs(state.levels) do
        level.samples = level.samples or {}
        level.scratch = level.scratch or {}
        stats.tileCapacity = stats.tileCapacity + #level.tiles
        stats.vertexCapacity = stats.vertexCapacity + level.vertexCapacity
        local originX = math.floor(x / level.step) * level.step
        local originY = math.floor(y / level.step) * level.step
        local scaleId = options.scaleId or "local"
        local needsFull = level.scaleId ~= scaleId or level.originX == nil or level.originY == nil
        if needsFull then
            stats.samplesRefilled = stats.samplesRefilled + fullRefill(level, originX, originY, sampleFn)
            stats.refilledRings = stats.refilledRings + 1
            stats.fullRefills = stats.fullRefills + 1
            level.scaleId = scaleId
        else
            local dx = math.floor((originX - level.originX) / level.step)
            local dy = math.floor((originY - level.originY) / level.step)
            if dx == 0 and dy == 0 then
                stats.reusedRings = stats.reusedRings + 1
            elseif math.abs(dx) >= level.sampleSize or math.abs(dy) >= level.sampleSize then
                stats.samplesRefilled = stats.samplesRefilled + fullRefill(level, originX, originY, sampleFn)
                stats.refilledRings = stats.refilledRings + 1
                stats.fullRefills = stats.fullRefills + 1
            else
                stats.samplesRefilled = stats.samplesRefilled + partialRefill(level, originX, originY, dx, dy, sampleFn)
                stats.refilledRings = stats.refilledRings + 1
                stats.partialRefills = stats.partialRefills + 1
            end
        end
    end
    state.lastUpdate = stats
    return state, stats
end

return Clipmap
