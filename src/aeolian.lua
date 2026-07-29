local Rng = require("src.rng")

local Aeolian = {}

local function clamp(value, minValue, maxValue)
    if value < minValue then return minValue end
    if value > maxValue then return maxValue end
    return value
end

local function key(gx, gy)
    return tostring(gx) .. ":" .. tostring(gy)
end

local function normalize(x, y)
    local length = math.sqrt(x * x + y * y)
    if length <= 0 then return 1, 0 end
    return x / length, y / length
end

local function roundStep(value)
    return value >= 0 and math.floor(value + 0.5) or math.ceil(value - 0.5)
end

local neighborOffsets = {
    { x = -1, y = 0 },
    { x = 1, y = 0 },
    { x = 0, y = -1 },
    { x = 0, y = 1 },
}

local function cellHeight(cell, slabHeight)
    return (cell.elevationBase or cell.elevation or 0) + (cell._duneSand or 0) * slabHeight
end

local function sandCandidate(cell, options)
    if cell.water or cell.river or cell.lake then return false end
    if options.allowAll then return true end
    return cell.biome == "desert"
end

local function collectCells(region, options)
    local cells = {}
    for _, cell in pairs(region.cells or {}) do
        cell.duneDelta = 0
        cell.duneAmplitude = 0
        cell.dunePhase = 0
        cell.duneMorphology = nil
        if sandCandidate(cell, options) then
            cells[#cells + 1] = cell
        end
    end
    table.sort(cells, function(a, b)
        if (a.gy or a.y or 0) == (b.gy or b.y or 0) then return (a.gx or a.x or 0) < (b.gx or b.x or 0) end
        return (a.gy or a.y or 0) < (b.gy or b.y or 0)
    end)
    return cells
end

local function initialSand(cell, seed, options)
    if cell.duneSand then return math.max(0, cell.duneSand) end
    local cover = options.sandCover
    if cover == nil then cover = 0.45 end
    return Rng.unitAt(seed, cell.gx or cell.x or 0, cell.gy or cell.y or 0, 1207) < cover and 1 or 0
end

local function windDirections(options, fallbackX, fallbackY)
    if options.windDirections then return options.windDirections end
    local wx, wy = normalize(options.windX or fallbackX or 1, options.windY or fallbackY or 0)
    if options.windRegime == "bimodal" then return { { x = wx, y = wy, weight = 0.6 }, { x = -wy, y = wx, weight = 0.4 } } end
    if options.windRegime == "multimodal" or options.windRegime == "star" then return { { x = wx, y = wy, weight = 0.34 }, { x = -wy, y = wx, weight = 0.33 }, { x = -wx, y = -wy, weight = 0.33 } } end
    return { { x = wx, y = wy, weight = 1 } }
end

local function pickDirection(directions, seed, iteration)
    local r = Rng.unitAt(seed, iteration, 11, 0, 0)
    local acc = 0
    for _, direction in ipairs(directions) do
        acc = acc + (direction.weight or 1 / #directions)
        if r <= acc then return normalize(direction.x or 1, direction.y or 0) end
    end
    local last = directions[#directions]
    return normalize(last.x or 1, last.y or 0)
end

local function isShadowed(region, cell, wx, wy, options)
    local slabHeight = options.slabHeight or 0.005
    local tanShadow = math.tan(math.rad(options.shadowAngleDegrees or 15))
    local maxK = options.shadowCells or 12
    local gx, gy = cell.gx or cell.x or 0, cell.gy or cell.y or 0
    local baseHeight = cellHeight(cell, slabHeight)
    for step = 1, maxK do
        local ux = gx - roundStep(wx * step)
        local uy = gy - roundStep(wy * step)
        local upwind = region.cells[key(ux, uy)]
        if upwind and cellHeight(upwind, slabHeight) - baseHeight > step * slabHeight * tanShadow then return true end
    end
    return false
end

local function repose(region, start, options)
    local slabHeight = options.slabHeight or 0.005
    local queue, seen = { start }, {}
    local limit = 0
    while #queue > 0 and limit < 64 do
        limit = limit + 1
        local cell = queue[#queue]
        queue[#queue] = nil
        local k0 = key(cell.gx or cell.x or 0, cell.gy or cell.y or 0)
        seen[k0] = true
        for _, offset in ipairs(neighborOffsets) do
            local neighbor = region.cells[key((cell.gx or cell.x or 0) + offset.x, (cell.gy or cell.y or 0) + offset.y)]
            if neighbor and sandCandidate(neighbor, options) then
                local diff = cellHeight(cell, slabHeight) - cellHeight(neighbor, slabHeight)
                if diff > slabHeight and (cell._duneSand or 0) > 0 then
                    cell._duneSand = cell._duneSand - 1
                    neighbor._duneSand = (neighbor._duneSand or 0) + 1
                    local nk = key(neighbor.gx or neighbor.x or 0, neighbor.gy or neighbor.y or 0)
                    if not seen[nk] then queue[#queue + 1] = neighbor end
                end
            end
        end
    end
end

local function transport(region, cell, wx, wy, seed, iteration, options)
    if (cell._duneSand or 0) <= 0 or isShadowed(region, cell, wx, wy, options) then return false end
    local jump = options.transportJump or 3
    local gx, gy = cell.gx or cell.x or 0, cell.gy or cell.y or 0
    cell._duneSand = cell._duneSand - 1
    for hop = 1, options.maxTransportHops or 5 do
        gx = gx + roundStep(wx * jump)
        gy = gy + roundStep(wy * jump)
        local target = region.cells[key(gx, gy)]
        if not (target and sandCandidate(target, options)) then break end
        local p = (target._duneSand or 0) > 0 and (options.pSand or 0.6) or (options.pRock or 0.4)
        if Rng.unitAt(seed, iteration, hop, gx, gy) < p then
            target._duneSand = (target._duneSand or 0) + 1
            repose(region, target, options)
            repose(region, cell, options)
            return true
        end
    end
    cell._duneSand = cell._duneSand + 1
    return false
end

local function morphology(options, sandCover, directions)
    if #directions >= 3 then return "star" end
    if #directions == 2 then return "seif" end
    if sandCover >= 0.65 then return "transverse" end
    if sandCover <= 0.45 then return "barchan" end
    return "parabolic"
end

function Aeolian.applyRegion(region, options)
    options = options or {}
    local seed = options.seed or region.seed or 1
    local cells = collectCells(region, options)
    if #cells == 0 then
        region.dunes = { cells = 0, activeCells = 0, morphology = "none", iterations = 0 }
        return region.dunes
    end
    local slabHeight = options.slabHeight or 0.005
    local sandTotal, fallbackX, fallbackY = 0, 0, 0
    for _, cell in ipairs(cells) do
        cell._initialDuneSand = initialSand(cell, seed, options)
        cell._duneSand = cell._initialDuneSand
        sandTotal = sandTotal + cell._duneSand
        fallbackX = fallbackX + (cell.windX or 0)
        fallbackY = fallbackY + (cell.windY or 0)
    end
    local sandCover = sandTotal / math.max(1, #cells)
    local directions = windDirections(options, fallbackX / #cells, fallbackY / #cells)
    local iterations = options.iterations or math.floor(#cells * (options.iterationsPerCell or 10))
    local moved = 0
    for iteration = 1, iterations do
        local index = math.floor(Rng.unitAt(seed, iteration, #cells, 1709, 0) * #cells) + 1
        local wx, wy = pickDirection(directions, seed, iteration)
        if transport(region, cells[index], wx, wy, seed, iteration, options) then moved = moved + 1 end
    end
    local meanSand = 0
    for _, cell in ipairs(cells) do meanSand = meanSand + (cell._duneSand or 0) end
    meanSand = meanSand / math.max(1, #cells)
    local active, maxAmplitude = 0, 0
    local morph = options.morphology or morphology(options, sandCover, directions)
    for _, cell in ipairs(cells) do
        local delta = ((cell._duneSand or 0) - meanSand) * slabHeight
        cell.duneDelta = clamp(delta, -0.08, 0.08)
        cell.duneAmplitude = math.abs(cell.duneDelta)
        cell.dunePhase = (cell.gx or cell.x or 0) * (directions[1].x or 1) + (cell.gy or cell.y or 0) * (directions[1].y or 0)
        cell.duneMorphology = morph
        if cell.duneAmplitude > 0 then active = active + 1 end
        maxAmplitude = math.max(maxAmplitude, cell.duneAmplitude)
        cell.elevation = (cell.elevation or cell.elevationBase or 0) + cell.duneDelta
        cell.slope = clamp((cell.slope or 0) + cell.duneAmplitude * 1.6, 0, 1)
        cell._duneSand = nil
        cell._initialDuneSand = nil
    end
    region.dunes = {
        cells = #cells,
        activeCells = active,
        moved = moved,
        sandCover = sandCover,
        morphology = morph,
        maxAmplitude = maxAmplitude,
        iterations = iterations,
    }
    return region.dunes
end

function Aeolian.applyCell(cell, seed)
    local region = { seed = seed, cells = {} }
    cell.gx = cell.gx or cell.x or 0
    cell.gy = cell.gy or cell.y or 0
    region.cells[key(cell.gx, cell.gy)] = cell
    Aeolian.applyRegion(region, { seed = seed, sandCover = cell.duneSand and 1 or 0, iterations = 0 })
    return cell
end

return Aeolian
