local Survey = require("src.survey")
local Atmosphere = require("src.atmosphere")
local ViewScale = require("src.viewscale")
local bit = require("bit")

local Save = {}
local worldsDir = "worlds"
local exportsDir = "exports"

local function isArray(value)
    local count = 0
    for k in pairs(value) do
        if type(k) ~= "number" or k < 1 or k % 1 ~= 0 then return false end
        count = math.max(count, k)
    end
    for index = 1, count do if value[index] == nil then return false end end
    return true, count
end

local function sortedKeys(value)
    local keys = {}
    for k in pairs(value) do keys[#keys + 1] = k end
    table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
    return keys
end

function Save.encode(value)
    local valueType = type(value)
    if valueType == "nil" then return "null" end
    if valueType == "boolean" or valueType == "number" then return tostring(value) end
    if valueType == "string" then return string.format("%q", value) end
    local array, count = isArray(value)
    local parts = {}
    if array then
        for index = 1, count do parts[#parts + 1] = Save.encode(value[index]) end
        return "[" .. table.concat(parts, ",") .. "]"
    end
    for _, key in ipairs(sortedKeys(value)) do
        parts[#parts + 1] = string.format("%q:%s", tostring(key), Save.encode(value[key]))
    end
    return "{" .. table.concat(parts, ",") .. "}"
end

local function parser(text)
    local index = 1
    local function skip()
        while string.match(string.sub(text, index, index), "%s") do index = index + 1 end
    end
    local function parseString()
        local start = index
        index = index + 1
        while index <= #text do
            local char = string.sub(text, index, index)
            if char == "\\" then
                index = index + 2
            elseif char == '"' then
                index = index + 1
                return assert(loadstring("return " .. string.sub(text, start, index - 1)))()
            else
                index = index + 1
            end
        end
        error("unterminated string")
    end
    local parseValue
    local function parseArray()
        index = index + 1
        local out = {}
        skip()
        if string.sub(text, index, index) == "]" then index = index + 1 return out end
        while true do
            out[#out + 1] = parseValue()
            skip()
            local char = string.sub(text, index, index)
            if char == "]" then index = index + 1 return out end
            if char ~= "," then error("expected array comma") end
            index = index + 1
        end
    end
    local function parseObject()
        index = index + 1
        local out = {}
        skip()
        if string.sub(text, index, index) == "}" then index = index + 1 return out end
        while true do
            skip()
            local key = parseString()
            skip()
            if string.sub(text, index, index) ~= ":" then error("expected object colon") end
            index = index + 1
            out[key] = parseValue()
            skip()
            local char = string.sub(text, index, index)
            if char == "}" then index = index + 1 return out end
            if char ~= "," then error("expected object comma") end
            index = index + 1
        end
    end
    function parseValue()
        skip()
        local char = string.sub(text, index, index)
        if char == '"' then return parseString() end
        if char == "{" then return parseObject() end
        if char == "[" then return parseArray() end
        local tail = string.sub(text, index)
        if string.sub(tail, 1, 4) == "true" then index = index + 4 return true end
        if string.sub(tail, 1, 5) == "false" then index = index + 5 return false end
        if string.sub(tail, 1, 4) == "null" then index = index + 4 return nil end
        local numberText = string.match(tail, "^-?%d+%.?%d*[eE]?[+-]?%d*")
        if numberText and #numberText > 0 then
            index = index + #numberText
            return tonumber(numberText)
        end
        error("invalid json value")
    end
    return parseValue()
end

function Save.decode(text)
    return parser(text)
end

local hashKeys = {
    "seed",
    "geologicTime",
    "scope",
    "allowExoticBiomes",
    "hydrologyRegionChunks",
    "hydrologyHaloCells",
    "hydrologyBasinChunks",
    "hydrologyBasinStride",
    "hydrologyBasinHaloCells",
    "hydrologyBasinFlowScale",
    "cacheMaxEntries",
}

local function stableHash(text)
    local h = 5381
    for index = 1, #text do h = (h * 33 + string.byte(text, index)) % 2147483647 end
    return string.format("%08x", h)
end

local function fs()
    return love and love.filesystem
end

local function safeName(value)
    local text = tostring(value or "world"):lower():gsub("[^%w%-_]+", "-"):gsub("^%-+", ""):gsub("%-+$", "")
    if text == "" then return "world" end
    return string.sub(text, 1, 48)
end

local function ensureLibrary()
    if not fs() then return end
    love.filesystem.createDirectory(worldsDir)
    love.filesystem.createDirectory(exportsDir)
end

local function worldPath(id)
    return worldsDir .. "/" .. tostring(id) .. ".json"
end

local function thumbnailPath(id)
    return worldsDir .. "/" .. tostring(id) .. ".png"
end

local function exportPath(id)
    return exportsDir .. "/" .. tostring(id) .. ".thoth-world"
end

local function newId(name)
    return safeName(name) .. "-" .. tostring(os.time()) .. "-" .. tostring(math.random(1000, 9999))
end

local function readFs(path)
    if not fs() then return nil end
    local info = love.filesystem.getInfo(path)
    if not info or info.type == "directory" then return nil end
    return love.filesystem.read(path)
end

local function writeFs(path, text)
    ensureLibrary()
    return love.filesystem.write(path, text)
end

local function copyMeta(snapshot, id, meta)
    local now = os.time()
    local previous = snapshot.meta or {}
    local name = meta and meta.name or previous.name or ("World " .. tostring(id))
    snapshot.meta = {
        id = id,
        name = name,
        seed = snapshot.seed,
        scope = snapshot.world and snapshot.world.scope or "local",
        createdAt = previous.createdAt or now,
        lastPlayed = now,
        thumbnailPath = thumbnailPath(id),
    }
    return snapshot.meta
end

local crcTable

local function unsigned32(value)
    if value < 0 then return value + 4294967296 end
    return value
end

local function crc32(data)
    if not crcTable then
        crcTable = {}
        for i = 0, 255 do
            local c = i
            for _ = 1, 8 do
                if bit.band(c, 1) ~= 0 then c = bit.bxor(0xedb88320, bit.rshift(c, 1)) else c = bit.rshift(c, 1) end
            end
            crcTable[i + 1] = c
        end
    end
    local crc = 0xffffffff
    for index = 1, #data do
        local b = string.byte(data, index)
        crc = bit.bxor(bit.rshift(crc, 8), crcTable[bit.band(bit.bxor(crc, b), 0xff) + 1])
    end
    return unsigned32(bit.bnot(crc))
end

local function le16(value)
    value = unsigned32(value)
    return string.char(value % 256, math.floor(value / 256) % 256)
end

local function le32(value)
    value = unsigned32(value)
    return string.char(value % 256, math.floor(value / 256) % 256, math.floor(value / 65536) % 256, math.floor(value / 16777216) % 256)
end

local function zipStore(files)
    local out, central = {}, {}
    local offset = 0
    local function push(part)
        out[#out + 1] = part
        offset = offset + #part
    end
    for _, file in ipairs(files) do
        local name, bytes = file.name, file.bytes or ""
        local crc = crc32(bytes)
        local localOffset = offset
        local header = table.concat({
            le32(0x04034b50), le16(20), le16(0), le16(0), le16(0), le16(0),
            le32(crc), le32(#bytes), le32(#bytes), le16(#name), le16(0), name,
        })
        push(header)
        push(bytes)
        central[#central + 1] = table.concat({
            le32(0x02014b50), le16(20), le16(20), le16(0), le16(0), le16(0), le16(0),
            le32(crc), le32(#bytes), le32(#bytes), le16(#name), le16(0), le16(0),
            le16(0), le16(0), le32(0), le32(localOffset), name,
        })
    end
    local centralOffset = offset
    local centralBytes = table.concat(central)
    push(centralBytes)
    push(table.concat({
        le32(0x06054b50), le16(0), le16(0), le16(#files), le16(#files),
        le32(#centralBytes), le32(centralOffset), le16(0),
    }))
    return table.concat(out)
end

function Save.worldOptionsHash(metadata)
    local source = {}
    for _, key in ipairs(hashKeys) do source[key] = metadata and metadata[key] end
    return stableHash(Save.encode(source))
end

function Save.snapshot(app)
    local metadata = app.world:metadata()
    return {
        version = 1,
        meta = app.saveSlotId and {
            id = app.saveSlotId,
            name = app.worldName or "World",
        } or nil,
        seed = metadata.seed,
        world = {
            scope = metadata.scope,
            allowExoticBiomes = metadata.allowExoticBiomes == true,
            optionsHash = Save.worldOptionsHash(metadata),
            geologicTime = metadata.geologicTime,
            geologicTimeStep = metadata.geologicTimeStep,
            hydrologyRegionChunks = metadata.hydrologyRegionChunks,
            hydrologyHaloCells = metadata.hydrologyHaloCells,
            hydrologyBasinChunks = metadata.hydrologyBasinChunks,
            hydrologyBasinStride = metadata.hydrologyBasinStride,
            hydrologyBasinHaloCells = metadata.hydrologyBasinHaloCells,
            hydrologyBasinFlowScale = metadata.hydrologyBasinFlowScale,
            cacheMaxEntries = metadata.cacheMaxEntries,
            seaLevel = metadata.baseSeaLevel or metadata.seaLevel,
            seaLevelAmplitude1 = metadata.seaLevelAmplitude1,
            seaLevelPeriod1 = metadata.seaLevelPeriod1,
            seaLevelAmplitude2 = metadata.seaLevelAmplitude2,
            seaLevelPeriod2 = metadata.seaLevelPeriod2,
            seaLevelResidualAmplitude = metadata.seaLevelResidualAmplitude,
            zScale = metadata.zScale,
            maxOceanAgeMyr = metadata.maxOceanAgeMyr,
            worldCircumference = metadata.worldCircumference,
            omega = metadata.omega,
            legacyLatitude = metadata.legacyLatitude,
            hillslopeD = metadata.hillslopeD,
            hillslopeSc = metadata.hillslopeSc,
            hillslopeIterations = metadata.hillslopeIterations,
            debrisK = metadata.debrisK,
            debrisCriticalConcentration = metadata.debrisCriticalConcentration,
            debrisSedimentYield = metadata.debrisSedimentYield,
            glacialGamma = metadata.glacialGamma,
            glacialBeta = metadata.glacialBeta,
            glacialBmax = metadata.glacialBmax,
            glacialKg = metadata.glacialKg,
            glacialSiaIterations = metadata.glacialSiaIterations,
            seasonRate = metadata.seasonRate,
            itczOffsetAmp = metadata.itczOffsetAmp,
            monsoonSeasonalContrast = metadata.monsoonSeasonalContrast,
            windCoriolisScale = metadata.windCoriolisScale,
            hotspotCount = metadata.hotspotCount,
            hotspotMantleExtent = metadata.hotspotMantleExtent,
            hotspotMinSeparation = metadata.hotspotMinSeparation,
            hotspotBucketSize = metadata.hotspotBucketSize,
            hotspotSigma = metadata.hotspotSigma,
            hotspotTrailSteps = metadata.hotspotTrailSteps,
            hotspotTrailDt = metadata.hotspotTrailDt,
            hotspotTau = metadata.hotspotTau,
            hotspotElevationScale = metadata.hotspotElevationScale,
            floodBasaltThreshold = metadata.floodBasaltThreshold,
            meanderWidthScale = metadata.meanderWidthScale,
            meanderMigrationScale = metadata.meanderMigrationScale,
        },
        player = { x = app.player.x, y = app.player.y },
        camera = { yaw = app.camera.yaw, pitch = app.camera.pitch },
        atmosphere = Atmosphere.snapshot(app.atmosphere),
        display = {
            pixelScale = app.pixelScale,
            mouseLook = app.mouseLook == true,
            debugPerf = app.debugPerf == true,
            debugTopo = app.debugTopo == true,
            minimap = app.minimap == true,
            showWorldLabels = app.showWorldLabels ~= false,
            showAreaLabels = app.showAreaLabels ~= false,
            showPlayerHud = app.showPlayerHud ~= false,
            debugPanels = (function()
                if type(app.debugPanels) == "table" then
                    return {
                        plate = app.debugPanels.plate == true,
                        drainage = app.debugPanels.drainage == true,
                        erosion = app.debugPanels.erosion == true,
                        biome = app.debugPanels.biome == true,
                    }
                end
                local on = app.debugPanels == true
                return { plate = on, drainage = on, erosion = on, biome = on }
            end)(),
            viewScale = ViewScale.activeScale(app.viewScale),
        },
        survey = Survey.snapshot(app.survey),
    }
end

function Save.writeWorld(id, snapshot, meta, thumbnailData)
    ensureLibrary()
    id = id or newId(meta and meta.name or snapshot.meta and snapshot.meta.name)
    copyMeta(snapshot, id, meta)
    assert(writeFs(worldPath(id), Save.encode(snapshot) .. "\n"))
    if thumbnailData then
        local bytes = thumbnailData.getString and thumbnailData:getString() or tostring(thumbnailData)
        assert(writeFs(thumbnailPath(id), bytes))
    end
    return id
end

function Save.readWorld(id)
    local text = readFs(worldPath(id))
    if not text then return nil end
    return Save.decode(text)
end

function Save.listWorlds()
    ensureLibrary()
    local out = {}
    if not fs() then return out end
    for _, item in ipairs(love.filesystem.getDirectoryItems(worldsDir)) do
        if item:match("%.json$") then
            local id = item:gsub("%.json$", "")
            local ok, snapshot = pcall(Save.readWorld, id)
            if ok and type(snapshot) == "table" then
                local meta = snapshot.meta or {}
                out[#out + 1] = {
                    id = id,
                    name = meta.name or ("World " .. id),
                    seed = meta.seed or snapshot.seed,
                    scope = meta.scope or snapshot.world and snapshot.world.scope or "local",
                    createdAt = meta.createdAt or 0,
                    lastPlayed = meta.lastPlayed or 0,
                    thumbnailPath = meta.thumbnailPath or thumbnailPath(id),
                }
            end
        end
    end
    table.sort(out, function(a, b)
        if (a.lastPlayed or 0) == (b.lastPlayed or 0) then return tostring(a.name) < tostring(b.name) end
        return (a.lastPlayed or 0) > (b.lastPlayed or 0)
    end)
    return out
end

function Save.deleteWorld(id)
    if not fs() then return false end
    love.filesystem.remove(worldPath(id))
    love.filesystem.remove(thumbnailPath(id))
    return true
end

function Save.renameWorld(id, name)
    local snapshot = Save.readWorld(id)
    if not snapshot then return false end
    snapshot.meta = snapshot.meta or {}
    snapshot.meta.name = tostring(name or snapshot.meta.name or id)
    Save.writeWorld(id, snapshot, snapshot.meta)
    return true
end

function Save.exportWorld(id)
    ensureLibrary()
    local snapshot = Save.readWorld(id)
    if not snapshot then return nil end
    local thumbnail = readFs(thumbnailPath(id))
    local files = { { name = "world.json", bytes = Save.encode(snapshot) .. "\n" } }
    if thumbnail then files[#files + 1] = { name = "thumbnail.png", bytes = thumbnail } end
    local bytes = zipStore(files)
    local path = exportPath(id)
    assert(writeFs(path, bytes))
    return path
end

function Save.migrateLegacy(path)
    path = path or "thoth-save.json"
    if not fs() then return nil end
    ensureLibrary()
    if #Save.listWorlds() > 0 then return nil end
    local handle = io.open(path, "r")
    if not handle then return nil end
    local text = handle:read("*a")
    handle:close()
    local snapshot = Save.decode(text)
    return Save.writeWorld(nil, snapshot, { name = "Imported World" })
end

function Save.write(path, snapshot)
    local handle = assert(io.open(path, "w"))
    handle:write(Save.encode(snapshot))
    handle:write("\n")
    handle:close()
end

function Save.read(path)
    local handle = assert(io.open(path, "r"))
    local text = handle:read("*a")
    handle:close()
    return Save.decode(text)
end

return Save
