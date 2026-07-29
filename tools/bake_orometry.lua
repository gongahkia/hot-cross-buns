#!/usr/bin/env luajit

local order = { "alps", "appalachians", "himalaya", "andes", "fjordland", "basinrange" }
local fallback = dofile("assets/orometry/archetypes.lua")

local function quote(value)
    return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
end

local function percentile(values, p)
    table.sort(values)
    if #values == 0 then return 0 end
    local index = math.max(1, math.min(#values, math.floor(#values * p + 0.5)))
    return values[index]
end

local function elevationStats(path)
    local pipe = io.popen("gdal_translate -q -of XYZ " .. quote(path) .. " /vsistdout/ 2>/dev/null")
    if not pipe then return nil end
    local values = {}
    for line in pipe:lines() do
        local z = tonumber(line:match("%S+%s+%S+%s+([%-%.%d]+)"))
        if z and z > -1000 and z < 9000 then values[#values + 1] = z end
    end
    pipe:close()
    if #values == 0 then return nil end
    local p50 = percentile(values, 0.50)
    local p95 = percentile(values, 0.95)
    local p05 = percentile(values, 0.05)
    return { reliefP50 = p50 - p05, reliefP95 = p95 - p05 }
end

local function mergeTiles(entry, tiles)
    local reliefP50, reliefP95, count = 0, 0, 0
    for _, tile in ipairs(tiles or {}) do
        local stats = elevationStats(tile)
        if stats then
            reliefP50 = reliefP50 + stats.reliefP50
            reliefP95 = reliefP95 + stats.reliefP95
            count = count + 1
        end
    end
    if count > 0 then
        entry.reliefP50 = reliefP50 / count
        entry.reliefP95 = reliefP95 / count
    end
end

local function loadManifest(path, data)
    if not path then return end
    local ok, manifest = pcall(dofile, path)
    assert(ok and type(manifest) == "table", "manifest must return a table")
    for _, key in ipairs(order) do
        if manifest[key] and manifest[key].tiles then mergeTiles(data[key], manifest[key].tiles) end
    end
end

local function writeValue(file, value, indent)
    if type(value) == "table" then
        file:write("{ ")
        for index, item in ipairs(value) do
            if index > 1 then file:write(", ") end
            writeValue(file, item, indent)
        end
        file:write(" }")
    elseif type(value) == "string" then
        file:write(string.format("%q", value))
    else
        file:write(tostring(value))
    end
end

local function writeEntry(file, key, entry)
    file:write("    " .. key .. " = {\n")
    for _, field in ipairs({ "id", "name", "peakProminenceHist", "saddleProminenceHist", "peakDensityPerKm2", "ridgelineSpacingMean", "ridgelineSpacingStd", "meanSlope", "reliefP95", "reliefP50", "peakAmpScale", "ridgeFreqScale", "slopeBias", "reliefScale" }) do
        file:write("        " .. field .. " = ")
        writeValue(file, entry[field], 8)
        file:write(",\n")
    end
    file:write("    },\n")
end

local function writeLua(path, data)
    os.execute("mkdir -p " .. quote(path:match("^(.*)/") or "."))
    local file = assert(io.open(path, "w"))
    file:write("return {\n")
    file:write("    order = ")
    writeValue(file, order, 4)
    file:write(",\n")
    for _, key in ipairs(order) do writeEntry(file, key, data[key]) end
    file:write("}\n")
    file:close()
end

local out = "assets/orometry/archetypes.lua"
local manifest
for index = 1, #arg do
    if arg[index] == "--out" then out = arg[index + 1] or out end
    if arg[index] == "--manifest" then manifest = arg[index + 1] end
end

loadManifest(manifest, fallback)
writeLua(out, fallback)
print("orometry-archetypes-written=" .. out)
