local Rng = require("src.rng")

local Karst = {}

local function clamp(value, minValue, maxValue)
    if value < minValue then return minValue end
    if value > maxValue then return maxValue end
    return value
end

local function key(gx, gy)
    return tostring(gx) .. ":" .. tostring(gy)
end

local function carbonate(cell)
    return cell and cell.lithology == 4
end

local function latitudeUnit(cell)
    return math.abs(cell.latitudeRadians or 0) / (math.pi / 2)
end

local function candidateKind(cell, seaLevel)
    local rainfall = cell.rainfall or cell.precipitation or 0
    local latitude = latitudeUnit(cell)
    local elevation = cell.elevationBase or cell.elevation or 0
    local slope = cell.slope or 0
    if rainfall > 0.7 and latitude < 0.35 then return 3 end
    if elevation > seaLevel + 0.2 and rainfall > 0.3 then return 1 end
    if slope < 0.05 and elevation < 0.3 then return 2 end
    return 4
end

local function stampRadius(kind, seed, gx, gy, stride)
    if kind == 1 then return (1 + math.floor(Rng.unitAt(seed, gx, gy, 1021) * 2)) * stride end
    if kind == 2 then return (3 + math.floor(Rng.unitAt(seed, gx, gy, 1023) * 3)) * stride end
    if kind == 3 then return stride end
    return stride
end

local function stampDelta(kind, seed, gx, gy)
    if kind == 1 then return -(0.04 + Rng.unitAt(seed, gx, gy, 1031) * 0.06) end
    if kind == 2 then return -0.02 end
    if kind == 3 then return 0.18 end
    return 0
end

local function applyDelta(cell, delta, kind)
    cell.karstType = math.max(cell.karstType or 0, kind)
    if delta < 0 then cell.karstDepth = math.max(cell.karstDepth or 0, -delta) end
    local base = cell.elevationBase or cell.elevation or 0
    local elevation = cell.elevation or base
    local bedrock = cell.bedrockElevation or base
    cell.elevationBase = base + delta
    cell.elevation = elevation + delta
    cell.bedrockElevation = bedrock + delta
end

local function applyStamp(region, center, kind, seed, radius, baseDelta)
    local affected, sinkholes, cenotes = 0, 0, 0
    local gx0, gy0 = center.gx or 0, center.gy or 0
    local minX, maxX = math.floor(gx0 - radius), math.ceil(gx0 + radius)
    local minY, maxY = math.floor(gy0 - radius), math.ceil(gy0 + radius)
    for gy = minY, maxY do
        for gx = minX, maxX do
            local cell = region.cells[key(gx, gy)]
            if carbonate(cell) then
                local dx, dy = gx - gx0, gy - gy0
                local dist = math.sqrt(dx * dx + dy * dy)
                if dist <= radius then
                    local t = radius <= 0 and 0 or dist / radius
                    local delta = baseDelta
                    if kind == 1 then delta = baseDelta * (1 + math.cos(math.pi * t)) * 0.5 end
                    if kind == 3 then delta = baseDelta * (1 - t) end
                    applyDelta(cell, delta, kind)
                    if kind == 1 and t <= 0.38 then
                        cell.sinkhole = true
                        sinkholes = sinkholes + 1
                        if t <= 0.18 and (cell.karstDepth or 0) > 0.055 and (cell.rainfall or cell.precipitation or 0) > 0.22 then
                            cell.cenote = true
                            cenotes = cenotes + 1
                        end
                    end
                    affected = affected + 1
                end
            end
        end
    end
    return affected, sinkholes, cenotes
end

local function pruneCandidates(candidates, radius)
    local kept = {}
    local minDistance2 = radius * radius
    for _, candidate in ipairs(candidates) do
        local ok = true
        for _, other in ipairs(kept) do
            local dx, dy = (candidate.gx or 0) - (other.gx or 0), (candidate.gy or 0) - (other.gy or 0)
            if dx * dx + dy * dy < minDistance2 then
                ok = false
                break
            end
        end
        if ok then kept[#kept + 1] = candidate end
    end
    return kept
end

function Karst.applyRegion(region, options)
    options = options or {}
    local seed = options.seed or region.seed or 1
    local seaLevel = options.seaLevel or region.seaLevel or 0
    local stride = math.max(1, options.stride or region.stride or 1)
    local density = options.density or 0.04
    local candidates, carbonateCells = {}, 0
    for _, cell in pairs(region.cells or {}) do
        cell.karstDepth = 0
        cell.cavePresence = 0
        cell.karstType = 0
        cell.sinkhole = false
        cell.cenote = false
        if carbonate(cell) then
            carbonateCells = carbonateCells + 1
            local gx, gy = cell.gx or cell.x or 0, cell.gy or cell.y or 0
            cell.cavePresence = 0.2 + Rng.unitAt(seed, gx, gy, 1049) * 0.4
            local rainfall = cell.rainfall or cell.precipitation or 0
            local climateMod = clamp(rainfall * (1 - latitudeUnit(cell) * 0.5), 0, 1)
            if Rng.unitAt(seed, gx, gy, 1009) < density * climateMod then candidates[#candidates + 1] = cell end
        end
    end
    table.sort(candidates, function(a, b)
        local ah = Rng.hash(seed, a.gx or 0, a.gy or 0, 1019)
        local bh = Rng.hash(seed, b.gx or 0, b.gy or 0, 1019)
        if ah == bh then
            if (a.gy or 0) == (b.gy or 0) then return (a.gx or 0) < (b.gx or 0) end
            return (a.gy or 0) < (b.gy or 0)
        end
        return ah < bh
    end)
    candidates = pruneCandidates(candidates, 2 * stride)
    local stats = { carbonateCells = carbonateCells, candidates = #candidates, features = 0, dolines = 0, poljes = 0, towers = 0, plains = 0, sinkholes = 0, cenotes = 0, affectedCells = 0, maxDepth = 0 }
    for _, center in ipairs(candidates) do
        local gx, gy = center.gx or 0, center.gy or 0
        local kind = options.forceKind or candidateKind(center, seaLevel)
        local radius = stampRadius(kind, seed, gx, gy, stride)
        local delta = stampDelta(kind, seed, gx, gy)
        local affected, sinkholes, cenotes = applyStamp(region, center, kind, seed, radius, delta)
        if affected > 0 then
            stats.features = stats.features + 1
            stats.affectedCells = stats.affectedCells + affected
            stats.sinkholes = stats.sinkholes + sinkholes
            stats.cenotes = stats.cenotes + cenotes
            if kind == 1 then stats.dolines = stats.dolines + 1 end
            if kind == 2 then stats.poljes = stats.poljes + 1 end
            if kind == 3 then stats.towers = stats.towers + 1 end
            if kind == 4 then stats.plains = stats.plains + 1 end
        end
    end
    for _, cell in pairs(region.cells or {}) do
        stats.maxDepth = math.max(stats.maxDepth, cell.karstDepth or 0)
    end
    region.karst = stats
    return stats
end

return Karst
