local Rng = require("src.rng")

local Meander = {}

local function clamp(value, minValue, maxValue)
    if value < minValue then return minValue end
    if value > maxValue then return maxValue end
    return value
end

local function key(gx, gy)
    return tostring(gx) .. ":" .. tostring(gy)
end

local function distance(ax, ay, bx, by)
    local dx, dy = bx - ax, by - ay
    return math.sqrt(dx * dx + dy * dy)
end

local function pointFor(cell)
    return cell.gx or cell.x or 0, cell.gy or cell.y or 0
end

local function channelWidth(cell, threshold, widthScale)
    return clamp(math.sqrt(math.max(threshold, cell.flow or threshold) / math.max(1, threshold)) * widthScale, 1.25, 5.5)
end

local function curvature(prev, cell, nextCell)
    local px, py = pointFor(prev)
    local cx, cy = pointFor(cell)
    local nx, ny = pointFor(nextCell)
    local ax, ay = px - cx, py - cy
    local bx, by = nx - cx, ny - cy
    local chord = distance(px, py, nx, ny)
    local la = math.max(0.000001, distance(px, py, cx, cy))
    local lb = math.max(0.000001, distance(cx, cy, nx, ny))
    return 2 * (ax * by - ay * bx) / math.max(0.000001, la * lb * chord)
end

local function collectSegments(region)
    local upstreams, starts, segments, seen = {}, {}, {}, {}
    for _, cell in pairs(region.cells or {}) do
        if cell.river and cell.downCell and cell.downCell.river then
            local list = upstreams[cell.downCell]
            if not list then
                list = {}
                upstreams[cell.downCell] = list
            end
            list[#list + 1] = cell
        end
    end
    for _, cell in pairs(region.cells or {}) do
        if cell.river and cell.downCell and cell.downCell.river and #(upstreams[cell] or {}) == 0 then
            starts[#starts + 1] = cell
        end
    end
    local function trace(start)
        local chain, cursor, guard = {}, start, 0
        while cursor and cursor.river and not seen[cursor] and guard < 20000 do
            chain[#chain + 1] = cursor
            seen[cursor] = true
            if not (cursor.downCell and cursor.downCell.river) then break end
            cursor = cursor.downCell
            guard = guard + 1
        end
        if #chain >= 4 then segments[#segments + 1] = chain end
    end
    table.sort(starts, function(a, b)
        if (a.gy or 0) == (b.gy or 0) then return (a.gx or 0) < (b.gx or 0) end
        return (a.gy or 0) < (b.gy or 0)
    end)
    for _, start in ipairs(starts) do trace(start) end
    for _, cell in pairs(region.cells or {}) do
        if cell.river and not seen[cell] then trace(cell) end
    end
    return segments
end

local function markOxbow(region, cell, nx, ny, width)
    local gx, gy = pointFor(cell)
    local ox = math.floor(gx + nx * width * 1.1 + 0.5)
    local oy = math.floor(gy + ny * width * 1.1 + 0.5)
    local oxbow = region.cells and region.cells[key(ox, oy)]
    if not oxbow or oxbow.water or oxbow.river then return false end
    oxbow.oxbowLake = true
    oxbow.floodplain = true
    oxbow.meanderBend = math.max(oxbow.meanderBend or 0, 0.5)
    region.oxbowPolygons[#region.oxbowPolygons + 1] = { x = ox, y = oy, radius = math.max(1, width * 0.7) }
    return true
end

function Meander.applyRegion(region, options)
    options = options or {}
    local threshold = options.threshold or region.threshold or 1
    local widthScale = options.widthScale or 1.8
    local migrationScale = options.migrationScale or 0.72
    local maxLowlandSlope = options.maxLowlandSlope or 0.16
    region.oxbowPolygons = {}
    for _, cell in pairs(region.cells or {}) do
        cell.meanderBend = 0
        cell.oxbowLake = false
    end
    local segments = collectSegments(region)
    local totalSinuosity, lowlandSegments, maxSinuosity, oxbowCount = 0, 0, 0, 0
    for _, segment in ipairs(segments) do
        local avgSlope, avgWidth, baseLength = 0, 0, 0
        for index, cell in ipairs(segment) do
            avgSlope = avgSlope + (cell.slope or 0)
            avgWidth = avgWidth + channelWidth(cell, threshold, widthScale)
            if index > 1 then
                local ax, ay = pointFor(segment[index - 1])
                local bx, by = pointFor(cell)
                baseLength = baseLength + distance(ax, ay, bx, by)
            end
        end
        avgSlope = avgSlope / #segment
        avgWidth = avgWidth / #segment
        local sx, sy = pointFor(segment[1])
        local ex, ey = pointFor(segment[#segment])
        local valleyLength = math.max(0.000001, distance(sx, sy, ex, ey))
        local lowland = avgSlope <= maxLowlandSlope
        local adjusted, phase = {}, Rng.unitAt(options.seed or 1, sx, sy, #segment, 1301) * math.pi * 2
        for index, cell in ipairs(segment) do
            local x, y = pointFor(cell)
            adjusted[index] = { x = x, y = y }
            if lowland and index > 1 and index < #segment then
                local px, py = pointFor(segment[index - 1])
                local nx0, ny0 = pointFor(segment[index + 1])
                local tx, ty = nx0 - px, ny0 - py
                local len = math.max(0.000001, math.sqrt(tx * tx + ty * ty))
                local normalX, normalY = -ty / len, tx / len
                local bend = clamp(curvature(segment[index - 1], cell, segment[index + 1]) * avgWidth * 3 + math.sin(index * 0.9 + phase) * migrationScale, -1, 1)
                cell.meanderBend = bend
                if math.abs(bend) > 0.16 then cell.floodplain = true end
                adjusted[index] = { x = x + normalX * bend * avgWidth, y = y + normalY * bend * avgWidth }
                if #segment >= 9 and math.abs(bend) >= 0.5 and index % 6 == 0 then
                    if markOxbow(region, cell, normalX * (bend >= 0 and 1 or -1), normalY * (bend >= 0 and 1 or -1), avgWidth) then
                        oxbowCount = oxbowCount + 1
                    end
                end
            end
        end
        local adjustedLength = 0
        for index = 2, #adjusted do
            adjustedLength = adjustedLength + distance(adjusted[index - 1].x, adjusted[index - 1].y, adjusted[index].x, adjusted[index].y)
        end
        local sinuosity = math.max(baseLength / valleyLength, adjustedLength / valleyLength)
        if lowland then
            lowlandSegments = lowlandSegments + 1
            totalSinuosity = totalSinuosity + sinuosity
            if sinuosity > maxSinuosity then maxSinuosity = sinuosity end
        end
    end
    region.meanders = {
        segments = #segments,
        lowlandSegments = lowlandSegments,
        meanSinuosity = totalSinuosity / math.max(1, lowlandSegments),
        maxSinuosity = maxSinuosity,
        oxbowLakes = oxbowCount,
    }
    return region.meanders
end

return Meander
