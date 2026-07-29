local Noise = require("src.noise")
local Rng = require("src.rng")
local Biomes = require("src.biomes")

local Weather = {}

Weather.bucketSeconds = 30
Weather.maxEventSeconds = 1200

local function clamp(value, minValue, maxValue)
    if value < minValue then return minValue end
    if value > maxValue then return maxValue end
    return value
end

local function metadata(world)
    if type(world) == "table" and type(world.metadata) == "function" then return world:metadata() end
    return world or {}
end

local function worldSeed(world)
    local meta = metadata(world)
    return tonumber(meta.seed) or tonumber(world and world.seed) or 1
end

local function geologicSalt(world)
    local meta = metadata(world)
    return math.floor((tonumber(meta.geologicTime) or tonumber(world and world.geologicTime) or 0) * 100000 + 0.5)
end

local function regionCoord(value)
    return math.floor((tonumber(value) or 0) / 96)
end

local function temperatureC(cell)
    return (tonumber(cell and cell.temperature) or 0.5) * 60 - 24
end

local function pressureOffset(id)
    id = tonumber(id) or 0
    if id == 1 or id == 6 then return 0.12 end
    if id == 2 or id == 5 then return -0.08 end
    if id == 3 then return -0.14 end
    return 0
end

function Weather.bucketFor(seconds)
    return math.floor(math.max(0, tonumber(seconds) or 0) / Weather.bucketSeconds)
end

function Weather.new(options)
    options = options or {}
    local bucket = tonumber(options.bucket)
    return {
        clock = tonumber(options.clock) or ((bucket or 0) * Weather.bucketSeconds),
        fixedBucket = bucket,
    }
end

function Weather.update(runtime, dt)
    if not runtime then return nil end
    if runtime.fixedBucket == nil then runtime.clock = (runtime.clock or 0) + (dt or 0) end
    return runtime
end

local function eventWindow(seed, salt, rx, ry, bucket)
    local seconds = bucket * Weather.bucketSeconds
    local segment = math.floor(seconds / Weather.maxEventSeconds)
    local durationBuckets = 1 + math.floor(Rng.unitAt(seed + 9101, rx, ry, segment, salt) * (Weather.maxEventSeconds / Weather.bucketSeconds))
    durationBuckets = clamp(durationBuckets, 1, Weather.maxEventSeconds / Weather.bucketSeconds)
    local duration = durationBuckets * Weather.bucketSeconds
    local start = segment * Weather.maxEventSeconds
    local active = seconds - start < duration
    return start, duration, segment, active
end

local function precipitationType(tempC, rainfall, intensity, storm, roll)
    if storm == "sandstorm" then return "clear" end
    if storm == "blizzard" then return "snow" end
    if storm == "hurricane" or (storm == "thunderstorm" and intensity > 0.62) then return roll > 0.92 and "hail" or "downpour" end
    if tempC <= -1 then return "snow" end
    if tempC <= 1.5 then return roll > 0.58 and "freezing_rain" or "sleet" end
    if tempC <= 3.5 then return "sleet" end
    if intensity > 0.68 or rainfall > 0.82 then return "downpour" end
    if intensity < 0.32 then return "drizzle" end
    return "rain"
end

local function audioCue(precipitation, storm)
    if storm == "sandstorm" or storm == "blizzard" or storm == "hurricane" then return "wind" end
    if storm == "thunderstorm" then return "thunder" end
    if precipitation == "rain" or precipitation == "downpour" or precipitation == "drizzle" or precipitation == "freezing_rain" then return "rain" end
    if precipitation == "snow" or precipitation == "sleet" or precipitation == "hail" then return "ice" end
    return "none"
end

function Weather.sample(world, cell, options)
    options = options or {}
    cell = cell or {}
    local seed = worldSeed(world)
    local salt = geologicSalt(world)
    local x = tonumber(options.x) or tonumber(cell.x) or 0
    local y = tonumber(options.y) or tonumber(cell.y) or 0
    local bucket = options.bucket ~= nil and math.max(0, math.floor(tonumber(options.bucket) or 0)) or Weather.bucketFor(options.clock)
    local seconds = bucket * Weather.bucketSeconds
    local rx, ry = regionCoord(x), regionCoord(y)
    local eventStart, eventDuration, eventId, eventActive = eventWindow(seed, salt, rx, ry, bucket)
    local windX = tonumber(cell.windX) or 0
    local windY = tonumber(cell.windY) or 0
    local advX = x - windX * seconds * 0.045
    local advY = y - windY * seconds * 0.045
    local frontNoise = Noise.value(seed + 4201 + salt, advX * 0.0065, advY * 0.0065, eventId)
    local rainfall = clamp(tonumber(cell.rainfall or cell.precipitation or cell.moisture) or 0.35, 0, 1)
    local slope = clamp(tonumber(cell.slope) or 0, 0, 1)
    local tempC = temperatureC(cell)
    local pressure = clamp(0.52 + (frontNoise - 0.5) * 0.78 + pressureOffset(cell.pressureCellId) - rainfall * 0.08, 0, 1)
    local low = clamp((0.56 - pressure) * 2.4, 0, 1)
    local high = clamp((pressure - 0.54) * 2.0, 0, 1)
    local orographic = clamp(slope * 1.5 + ((cell.elevation or 0) > 0.36 and 0.08 or 0), 0, 0.35)
    local rainShadow = cell.rainShadow and 0.22 or 0
    local chance = clamp(rainfall * 0.58 + low * 0.34 + orographic - high * 0.28 - rainShadow, 0.02, 0.94)
    if not eventActive then chance = chance * 0.18 end
    local eventRoll = Rng.unitAt(seed + 9301, rx, ry, eventId, salt)
    local precipitating = eventRoll < chance
    local windSpeed = clamp(0.18 + math.sqrt(windX * windX + windY * windY) * 0.32 + math.abs(0.5 - pressure) * 0.92 + slope * 0.22, 0, 1)
    local convective = clamp((tempC - 12) / 22 + rainfall * 0.42 + low * 0.28, 0, 1)
    local stormRoll = Rng.unitAt(seed + 9401, rx, ry, eventId, salt)
    local storm = "none"
    if rainfall < 0.24 and windSpeed > 0.62 and stormRoll > 0.78 then
        storm = "sandstorm"
    elseif precipitating and tempC < -4 and windSpeed > 0.58 and stormRoll > 0.72 then
        storm = "blizzard"
    elseif precipitating and cell.water and tempC > 24 and low > 0.62 and stormRoll > 0.86 then
        storm = "hurricane"
    elseif precipitating and convective > 0.66 and stormRoll > 0.82 then
        storm = "thunderstorm"
    end
    local intensity = precipitating and clamp(chance * 0.55 + low * 0.32 + Rng.unitAt(seed + 9501, rx, ry, eventId, salt) * 0.28, 0.15, 1) or 0
    if storm ~= "none" then intensity = clamp(intensity + 0.28, 0.35, 1) end
    local precipitation = precipitating and precipitationType(tempC, rainfall, intensity, storm, Rng.unitAt(seed + 9601, rx, ry, eventId, salt)) or "clear"
    local cloudCover = clamp(rainfall * 0.34 + low * 0.42 + (precipitating and 0.32 or 0) + (storm ~= "none" and 0.22 or 0), 0.05, 1)
    local visibility = clamp(1 - cloudCover * 0.16 - intensity * 0.36 - (storm == "none" and 0 or 0.24), 0.18, 1)
    if storm == "sandstorm" then visibility = math.min(visibility, 0.28) end
    if storm == "blizzard" then visibility = math.min(visibility, 0.24) end
    if storm == "hurricane" then visibility = math.min(visibility, 0.2) end
    return {
        bucket = bucket,
        eventId = eventId,
        eventStart = eventStart,
        eventDuration = eventDuration,
        eventActive = eventActive,
        front = low > 0.35 and "low" or (high > 0.35 and "high" or "zonal"),
        pressure = pressure,
        precipitation = precipitation,
        storm = storm,
        intensity = intensity,
        cloudCover = cloudCover,
        windSpeed = windSpeed,
        visibility = visibility,
        temperatureC = tempC,
        koppen = cell.koppen or Biomes.koppen(cell.temperature, cell.rainfall or cell.precipitation, cell),
        audioCue = audioCue(precipitation, storm),
        isPrecipitating = precipitation ~= "clear",
    }
end

function Weather.label(state)
    if not state then return "clear" end
    if state.storm and state.storm ~= "none" then return state.storm end
    return state.precipitation or "clear"
end

function Weather.particleCount(state, width, height)
    if not state then return 0 end
    local areaScale = clamp(((width or 1280) * (height or 720)) / (1280 * 720), 0.4, 1.8)
    local intensity = clamp(state.intensity or 0, 0, 1)
    if state.storm == "sandstorm" then return math.floor((90 + intensity * 160) * areaScale) end
    if state.precipitation == "snow" then return math.floor((50 + intensity * 130) * areaScale) end
    if state.precipitation == "rain" or state.precipitation == "downpour" or state.precipitation == "drizzle" or state.precipitation == "freezing_rain" then return math.floor((70 + intensity * 190) * areaScale) end
    if state.precipitation == "sleet" or state.precipitation == "hail" then return math.floor((45 + intensity * 115) * areaScale) end
    if (state.visibility or 1) < 0.7 then return math.floor((24 + (1 - (state.visibility or 1)) * 60) * areaScale) end
    return 0
end

return Weather
