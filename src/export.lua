local Render = require("src.render")

local Export = {}

local function clamp(value, minValue, maxValue)
    return math.max(minValue, math.min(maxValue, value))
end

local function mix(a, b, t)
    return a + (b - a) * t
end

local function byte(value)
    return math.floor(clamp(value, 0, 1) * 255 + 0.5)
end

local function colorFor(cell, palette)
    if cell.river then return cell.braidedRiver and { 0.28, 0.5, 0.52 } or palette.river end
    if cell.water then return (cell.lake or cell.cenote) and palette.lake or (palette[cell.biome] or palette.ocean) end
    local base = palette[cell.biome] or palette.grassland
    if cell.coastBeach then base = { 0.76, 0.68, 0.42 } end
    if cell.coastCliff then base = { 0.34, 0.33, 0.32 } end
    if cell.playa then base = { 0.86, 0.82, 0.64 } end
    if cell.alluvialFanLobe then base = { 0.64, 0.54, 0.34 } end
    if cell.sinkhole then base = { 0.24, 0.22, 0.2 } end
    if (cell.duneAmplitude or 0) > 0 then base = cell.duneDelta >= 0 and { 0.82, 0.73, 0.43 } or { 0.5, 0.42, 0.22 } end
    local t = clamp(((cell.elevation or 0) + 0.12) / 0.86, 0, 1)
    return {
        mix(base[1] * 0.72, base[1] * 1.18, t),
        mix(base[2] * 0.72, base[2] * 1.18, t),
        mix(base[3] * 0.72, base[3] * 1.18, t),
    }
end

function Export.renderMap(world, options)
    options = options or {}
    local size = math.max(8, math.floor(options.size or 128))
    local span = options.span or 512
    local scale = options.scale or "local"
    local centerX, centerY = options.x or 0, options.y or 0
    local step = span / math.max(1, size - 1)
    local originX = centerX - span * 0.5
    local originY = centerY - span * 0.5
    local palette = Render.biomePalette()
    local pixels = {}
    local stats = { land = 0, water = 0, rivers = 0 }
    for y = 1, size do
        for x = 1, size do
            local wx = originX + (x - 1) * step
            local wy = originY + (y - 1) * step
            local cell = world:sample(math.floor(wx), math.floor(wy), scale)
            if cell.water then stats.water = stats.water + 1 else stats.land = stats.land + 1 end
            if cell.river then stats.rivers = stats.rivers + 1 end
            local color = colorFor(cell, palette)
            pixels[#pixels + 1] = string.char(byte(color[1]), byte(color[2]), byte(color[3]))
        end
    end
    local metadata = {
        version = world:metadata().version,
        seed = world:metadata().seed,
        scale = scale,
        size = size,
        span = span,
        centerX = centerX,
        centerY = centerY,
        land = stats.land,
        water = stats.water,
        rivers = stats.rivers,
    }
    return { size = size, pixels = pixels, stats = stats, metadata = metadata }
end

local metadataKeys = { "version", "seed", "scale", "size", "span", "centerX", "centerY", "land", "water", "rivers" }

local function jsonValue(value)
    if type(value) == "number" then return tostring(value) end
    return string.format("%q", tostring(value))
end

function Export.metadataJson(metadata)
    local lines = { "{" }
    for index, key in ipairs(metadataKeys) do
        local comma = index < #metadataKeys and "," or ""
        lines[#lines + 1] = string.format("  %q: %s%s", key, jsonValue(metadata[key]), comma)
    end
    lines[#lines + 1] = "}"
    return table.concat(lines, "\n") .. "\n"
end

function Export.ppmBytes(map)
    return string.format("P6\n%d %d\n255\n", map.size, map.size) .. table.concat(map.pixels)
end

function Export.writePpm(path, map)
    local handle = assert(io.open(path, "wb"))
    handle:write(Export.ppmBytes(map))
    handle:close()
end

function Export.writeMetadata(path, metadata)
    local handle = assert(io.open(path, "w"))
    handle:write(Export.metadataJson(metadata))
    handle:close()
end

return Export
