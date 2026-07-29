package.path = "./?.lua;./?/init.lua;./src/?.lua;./src/?/init.lua;" .. package.path

local WorldGen = require("src.worldgen")

local prefix = ...
local jobs = love.thread.getChannel(prefix .. ".jobs")
local responses = love.thread.getChannel(prefix .. ".response")
local world
local worldKey

local function simpleCell(cell)
    local out = {}
    for k, v in pairs(cell) do
        local kind = type(v)
        if kind == "number" or kind == "string" or kind == "boolean" then out[k] = v end
    end
    return out
end

local function simpleChunk(chunk)
    local rows = {}
    for y = 1, chunk.size do
        local row = chunk.cells[y]
        rows[y] = {}
        for x = 1, chunk.size do
            local cell = row[x]
            rows[y][x] = simpleCell(cell)
        end
    end
    return {
        x = chunk.x,
        y = chunk.y,
        scale = chunk.scale,
        scaleFactor = chunk.scaleFactor,
        size = chunk.size,
        cells = rows,
    }
end

local function workerKey(message)
    local options = message.options or {}
    local function keyValue(value)
        if value == nil then return "" end
        return tostring(value)
    end
    return table.concat({
        message.seed,
        options.chunkSize or "",
        options.seaLevel or "",
        options.seaLevelAmplitude1 or "",
        options.seaLevelPeriod1 or "",
        options.seaLevelAmplitude2 or "",
        options.seaLevelPeriod2 or "",
        options.seaLevelResidualAmplitude or "",
        options.zScale or "",
        options.maxOceanAgeMyr or "",
        options.hydrologyRegionChunks or "",
        options.hydrologyHaloCells or "",
        options.hydrologyBasinChunks or "",
        options.hydrologyBasinStride or "",
        options.hydrologyBasinHaloCells or "",
        options.hydrologyBasinFlowScale or "",
        options.streamPowerIterations or "",
        options.streamPowerK or "",
        options.streamPowerM or "",
        options.streamPowerN or "",
        keyValue(options.streamPowerUplift),
        keyValue(options.streamPowerIsostasy),
        options.streamPowerIsostasyRatio or "",
        options.streamPowerIsostasyRadius or "",
        options.streamPowerDetailScale or "",
        options.streamPowerSedimentScale or "",
        options.hillslopeD or "",
        options.hillslopeSc or "",
        options.hillslopeIterations or "",
        options.debrisK or "",
        options.debrisCriticalConcentration or "",
        options.debrisSedimentYield or "",
        options.glacialDetailScale or "",
        options.glacialFreezeTemperature or "",
        options.glacialSnowline or "",
        options.glacialMinFlow or "",
        options.glacialMaxCut or "",
        options.glacialGamma or "",
        options.glacialBeta or "",
        options.glacialBmax or "",
        options.glacialKg or "",
        options.glacialSiaIterations or "",
        options.iceFieldEntries or "",
        options.seasonRate or "",
        options.itczOffsetAmp or "",
        options.monsoonSeasonalContrast or "",
        options.windCoriolisScale or "",
        options.hotspotCount or "",
        options.hotspotMantleExtent or "",
        options.hotspotMinSeparation or "",
        options.hotspotBucketSize or "",
        options.hotspotSigma or "",
        options.hotspotTrailSteps or "",
        options.hotspotTrailDt or "",
        options.hotspotTau or "",
        options.hotspotElevationScale or "",
        options.floodBasaltThreshold or "",
        options.meanderWidthScale or "",
        options.meanderMigrationScale or "",
        options.orographicLiftScale or "",
        options.orographicLeeScale or "",
        options.cacheMaxEntries or "",
        options.geologicTime or "",
        options.geologicTimeStep or "",
        options.worldCircumference or "",
        options.omega or "",
        tostring(options.legacyLatitude),
    }, "|")
end

while true do
    local message = jobs:demand()
    if message.quit then break end
    local ok, result = pcall(function()
        local key = workerKey(message)
        if not world or key ~= worldKey then
            world = WorldGen.new(message.seed, message.options or {})
            worldKey = key
        end
        return simpleChunk(world:chunk(message.chunkX, message.chunkY, message.scale))
    end)
    responses:push({
        key = message.key,
        ok = ok,
        chunk = ok and result or nil,
        error = ok and nil or tostring(result),
    })
end
