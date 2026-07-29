local Coast = {}

local function clamp(value, minValue, maxValue)
    if value < minValue then return minValue end
    if value > maxValue then return maxValue end
    return value
end

local function key(gx, gy)
    return tostring(gx) .. ":" .. tostring(gy)
end

local neighbors = {
    { x = -1, y = -1, distance = 1.41421356237 },
    { x = 0, y = -1, distance = 1 },
    { x = 1, y = -1, distance = 1.41421356237 },
    { x = -1, y = 0, distance = 1 },
    { x = 1, y = 0, distance = 1 },
    { x = -1, y = 1, distance = 1.41421356237 },
    { x = 0, y = 1, distance = 1 },
    { x = 1, y = 1, distance = 1.41421356237 },
}

local componentNeighbors = {
    { x = -1, y = -1 },
    { x = 0, y = -1 },
    { x = 1, y = -1 },
    { x = -1, y = 0 },
    { x = 1, y = 0 },
    { x = -1, y = 1 },
    { x = 0, y = 1 },
    { x = 1, y = 1 },
}

local function angleDiff(a, b)
    local d = (a - b + math.pi) % (math.pi * 2) - math.pi
    return d
end

local function smoothstep(minValue, maxValue, value)
    local t = clamp((value - minValue) / (maxValue - minValue), 0, 1)
    return t * t * (3 - 2 * t)
end

local function nodeKey(node)
    return key(node.cell.gx or 0, node.cell.gy or 0)
end

local function coastNormal(region, cell)
    local nx, ny, waterNeighbors = 0, 0, 0
    for _, offset in ipairs(neighbors) do
        local neighbor = region.cells[key((cell.gx or 0) + offset.x, (cell.gy or 0) + offset.y)]
        if neighbor and neighbor.water then
            nx = nx - offset.x / offset.distance
            ny = ny - offset.y / offset.distance
            waterNeighbors = waterNeighbors + 1
        end
    end
    local length = math.sqrt(nx * nx + ny * ny)
    if length <= 0 then return nil end
    return nx / length, ny / length, waterNeighbors
end

local function sortCells(a, b)
    if a.cell.gy == b.cell.gy then return a.cell.gx < b.cell.gx end
    return a.cell.gy < b.cell.gy
end

local function componentAxis(nodes)
    local minX, maxX, minY, maxY = math.huge, -math.huge, math.huge, -math.huge
    for _, node in ipairs(nodes) do
        minX = math.min(minX, node.cell.gx or 0)
        maxX = math.max(maxX, node.cell.gx or 0)
        minY = math.min(minY, node.cell.gy or 0)
        maxY = math.max(maxY, node.cell.gy or 0)
    end
    return (maxX - minX) >= (maxY - minY) and "x" or "y"
end

local function sortComponent(nodes)
    local axis = componentAxis(nodes)
    table.sort(nodes, function(a, b)
        if axis == "x" then
            if a.cell.gx == b.cell.gx then return a.cell.gy < b.cell.gy end
            return a.cell.gx < b.cell.gx
        end
        if a.cell.gy == b.cell.gy then return a.cell.gx < b.cell.gx end
        return a.cell.gy < b.cell.gy
    end)
end

local function extractShorelines(region)
    local candidates, byKey = {}, {}
    for _, cell in pairs(region.cells or {}) do
        cell.shorelineNode = 0
        cell.shorelineAdvance = 0
        cell.capeScore = 0
        cell.coastSpit = false
        if not cell.water then
            local nx, ny, waterNeighbors = coastNormal(region, cell)
            if nx then
                local node = {
                    cell = cell,
                    x = cell.gx or cell.x or 0,
                    y = cell.gy or cell.y or 0,
                    nx = nx,
                    ny = ny,
                    waterNeighbors = waterNeighbors,
                }
                candidates[#candidates + 1] = node
                byKey[nodeKey(node)] = node
            end
        end
    end
    table.sort(candidates, sortCells)
    local visited, shorelines, nodeIndex = {}, {}, 0
    for _, start in ipairs(candidates) do
        local startKey = nodeKey(start)
        if not visited[startKey] then
            local stack, component = { start }, {}
            visited[startKey] = true
            while #stack > 0 do
                local node = stack[#stack]
                stack[#stack] = nil
                component[#component + 1] = node
                local gx, gy = node.cell.gx or 0, node.cell.gy or 0
                for _, offset in ipairs(componentNeighbors) do
                    local nextNode = byKey[key(gx + offset.x, gy + offset.y)]
                    if nextNode and not visited[nodeKey(nextNode)] then
                        visited[nodeKey(nextNode)] = true
                        stack[#stack + 1] = nextNode
                    end
                end
            end
            sortComponent(component)
            local shoreline = {
                id = #shorelines + 1,
                nodes = component,
                length = math.max(0, (#component - 1) * (region.stride or 1) * (region.scaleFactor or 1)),
            }
            for _, node in ipairs(component) do
                nodeIndex = nodeIndex + 1
                node.index = nodeIndex
                node.shorelineId = shoreline.id
                node.cell.shorelineNode = nodeIndex
            end
            shorelines[#shorelines + 1] = shoreline
        end
    end
    return shorelines, nodeIndex
end

local function tangentAt(nodes, index)
    local node = nodes[index]
    local prev = nodes[math.max(1, index - 1)]
    local next = nodes[math.min(#nodes, index + 1)]
    local tx, ty = (next.x or 0) - (prev.x or 0), (next.y or 0) - (prev.y or 0)
    local length = math.sqrt(tx * tx + ty * ty)
    if length <= 0 then
        tx, ty = -node.ny, node.nx
        length = math.sqrt(tx * tx + ty * ty)
    end
    return tx / length, ty / length, math.atan2(ty, tx)
end

local function curvatureSeaward(nodes, index, ds)
    if index <= 1 or index >= #nodes then return 0 end
    local prev, node, next = nodes[index - 1], nodes[index], nodes[index + 1]
    local sx, sy = -node.nx, -node.ny
    local ddx = (next.x or 0) + (prev.x or 0) - 2 * (node.x or 0)
    local ddy = (next.y or 0) + (prev.y or 0) - 2 * (node.y or 0)
    return (ddx * sx + ddy * sy) / math.max(1, ds * ds)
end

local function defaultHighAngle(node)
    local windX, windY = node.cell.windX or 0, node.cell.windY or 0
    local tx, ty = tangentAt({ node }, 1)
    local along = math.abs(windX * tx + windY * ty)
    local latitude = math.abs(node.cell.latitudeRadians or 0)
    local stormTrack = smoothstep(math.rad(42), math.rad(56), latitude)
    return clamp(0.24 + along * 0.28 + stormTrack * 0.24, 0.12, 0.78)
end

local function waveAngle(node, phi, highAngleFraction, options)
    if options.waveAngleRadians then return phi + options.waveAngleRadians end
    if options.waveAngleDegrees then return phi + math.rad(options.waveAngleDegrees) end
    local windX, windY = node.cell.windX or 0, node.cell.windY or 0
    if math.abs(windX) + math.abs(windY) > 0.0001 then return math.atan2(windY, windX) end
    local sign = (options.asymmetry or 0) < 0 and -1 or 1
    return phi + sign * math.rad(highAngleFraction > 0.5 and 70 or 28)
end

local function longshoreFlux(node, phi, highAngleFraction, options)
    local theta = waveAngle(node, phi, highAngleFraction, options)
    local thetaB = angleDiff(theta, phi)
    local c = math.max(0, math.cos(thetaB))
    local hb = options.breakerHeight or 1.5
    return (options.transportK or 0.39) * (hb ^ (12 / 5)) * (c ^ (6 / 5)) * math.sin(thetaB)
end

local function applyShorelineInstability(region, shorelines, options)
    local capes, smoothed, maxCapeScore = 0, 0, 0
    region.spits = {}
    region.lagoons = {}
    for _, shoreline in ipairs(shorelines) do
        local nodes = shoreline.nodes
        if #nodes >= 3 then
            local ds = math.max(1, (region.stride or 1) * (region.scaleFactor or 1) * 4)
            local highAngleFraction = options.highAngleFraction or options.U_hi or defaultHighAngle(nodes[math.ceil(#nodes * 0.5)])
            local q = {}
            for index, node in ipairs(nodes) do
                local _, _, phi = tangentAt(nodes, index)
                q[index] = longshoreFlux(node, phi, highAngleFraction, options)
            end
            local targetSpit = nil
            local asymmetry = options.asymmetry or 0
            if highAngleFraction > 0.5 and math.abs(asymmetry) > 0.35 and #nodes >= 8 then
                targetSpit = asymmetry >= 0 and math.max(2, math.floor(#nodes * 0.78)) or math.min(#nodes - 1, math.floor(#nodes * 0.22))
            end
            for index, node in ipairs(nodes) do
                local curvature = curvatureSeaward(nodes, index, ds)
                local divergence = ((q[math.min(#nodes, index + 1)] or 0) - (q[math.max(1, index - 1)] or 0)) / (2 * ds)
                local highGain = math.max(0, highAngleFraction - 0.5)
                local lowGain = math.max(0, 0.3 - highAngleFraction)
                local advance = clamp(-divergence * 0.02 + highGain * math.max(0, -curvature) * 0.75 + lowGain * curvature * 0.55, -0.08, 0.08)
                local cell = node.cell
                cell.shorelineAdvance = advance
                cell.capeScore = highAngleFraction > 0.5 and math.max(0, -curvature) * highAngleFraction or 0
                maxCapeScore = math.max(maxCapeScore, cell.capeScore)
                if cell.capeScore > 0.008 and advance > 0 then
                    capes = capes + 1
                    cell.coastCape = true
                    cell.coastBeach = true
                    cell.coastDeposition = math.max(cell.coastDeposition or 0, advance * 0.35)
                    cell.elevation = math.max(cell.elevation or cell.elevationBase or 0, (options.seaLevel or region.seaLevel or 0) + 0.008)
                elseif lowGain > 0 and curvature < -0.004 then
                    smoothed = smoothed + 1
                    cell.coastErosion = math.max(cell.coastErosion or 0, math.abs(advance) * 0.25)
                end
                if targetSpit == index then
                    cell.coastSpit = true
                    cell.coastBeach = true
                    cell.coastDeposition = math.max(cell.coastDeposition or 0, 0.028 + math.abs(asymmetry) * 0.012)
                    region.spits[#region.spits + 1] = { x = cell.x or cell.gx, y = cell.y or cell.gy, shoreline = shoreline.id, node = node.index, direction = asymmetry >= 0 and 1 or -1 }
                    region.lagoons[#region.lagoons + 1] = { x = (cell.x or cell.gx) + node.nx * ds, y = (cell.y or cell.gy) + node.ny * ds, shoreline = shoreline.id, behind = node.index }
                end
            end
        end
    end
    return capes, smoothed, maxCapeScore
end

function Coast.apply(region, options)
    options = options or {}
    local seaLevel = options.seaLevel or 0
    local cliffs, beaches = 0, 0
    for _, cell in pairs(region.cells or {}) do
        cell.coastCliff = false
        cell.coastBeach = false
        cell.coastExposure = 0
        cell.coastErosion = 0
        cell.coastDeposition = 0
        cell.coastCape = false
        cell.coastSpit = false
    end
    local shorelines, shorelineNodes = extractShorelines(region)
    region.shorelines = shorelines
    for _, shoreline in ipairs(shorelines) do
        for _, node in ipairs(shoreline.nodes) do
            local cell = node.cell
            local windX, windY = cell.windX or 0, cell.windY or 0
            local exposure = clamp(windX * node.nx + windY * node.ny, 0, 1)
            local relief = math.max(0, (cell.elevation or cell.elevationBase or 0) - seaLevel)
            local sheltered = 1 - exposure
            cell.coastExposure = exposure
            if exposure > 0.42 and relief > 0.045 then
                local erosion = clamp(exposure * relief * 0.18, 0.004, 0.055)
                cell.coastCliff = true
                cell.coastErosion = erosion
                cell.elevation = (cell.elevation or cell.elevationBase or 0) - erosion
                cell.slope = clamp(math.max(cell.slope or 0, 0.2 + exposure * 0.18), 0, 1)
                cliffs = cliffs + 1
            elseif sheltered > 0.45 and relief < 0.22 then
                local sediment = cell.sediment or 0
                local deposition = clamp(0.006 + sheltered * 0.018 + sediment * 1.2 + node.waterNeighbors * 0.0015, 0.004, 0.045)
                cell.coastBeach = true
                cell.coastDeposition = deposition
                cell.elevation = math.max((cell.elevation or cell.elevationBase or 0) + deposition, seaLevel + 0.006)
                cell.slope = math.min(cell.slope or 0, 0.075)
                beaches = beaches + 1
            end
        end
    end
    local capes, smoothed, maxCapeScore = applyShorelineInstability(region, shorelines, options)
    region.coast = {
        cliffs = cliffs,
        beaches = beaches,
        shorelines = #shorelines,
        shorelineNodes = shorelineNodes,
        capes = capes,
        maxCapeScore = maxCapeScore,
        smoothed = smoothed,
        spits = #(region.spits or {}),
        lagoons = #(region.lagoons or {}),
    }
    return region.coast
end

return Coast
