local Atmosphere = {}

local seasons = { "spring", "summer", "autumn", "winter" }
local seasonIndex = { spring = 1, summer = 2, autumn = 3, winter = 4 }
local seasonPhase = { spring = 0, summer = 0.25, autumn = 0.5, winter = 0.75 }
local tau = math.pi * 2
local timeKeys = {
    { id = "dawn", time = 0 },
    { id = "noon", time = 0.25 },
    { id = "dusk", time = 0.5 },
    { id = "night", time = 0.75 },
    { id = "dawn", time = 1 },
}

local grades = {
    spring = {
        dawn = { tint = { 1.05, 0.94, 0.86 }, lift = { 0.035, 0.025, 0.03 }, exposure = 0.84, saturation = 0.9 },
        noon = { tint = { 0.96, 1.06, 0.96 }, lift = { 0.01, 0.025, 0.012 }, exposure = 1.05, saturation = 1.05 },
        dusk = { tint = { 1.08, 0.9, 0.82 }, lift = { 0.04, 0.015, 0.02 }, exposure = 0.82, saturation = 0.95 },
        night = { tint = { 0.42, 0.5, 0.78 }, lift = { 0.005, 0.008, 0.035 }, exposure = 0.42, saturation = 0.72 },
    },
    summer = {
        dawn = { tint = { 1.1, 0.92, 0.76 }, lift = { 0.045, 0.022, 0.018 }, exposure = 0.88, saturation = 0.95 },
        noon = { tint = { 1.05, 1.02, 0.88 }, lift = { 0.018, 0.018, 0.005 }, exposure = 1.08, saturation = 1.08 },
        dusk = { tint = { 1.14, 0.82, 0.66 }, lift = { 0.055, 0.018, 0.01 }, exposure = 0.8, saturation = 1.0 },
        night = { tint = { 0.35, 0.44, 0.82 }, lift = { 0.004, 0.006, 0.036 }, exposure = 0.38, saturation = 0.68 },
    },
    autumn = {
        dawn = { tint = { 1.12, 0.86, 0.72 }, lift = { 0.045, 0.016, 0.012 }, exposure = 0.82, saturation = 0.98 },
        noon = { tint = { 1.08, 0.93, 0.76 }, lift = { 0.025, 0.012, 0.004 }, exposure = 0.98, saturation = 1.02 },
        dusk = { tint = { 1.18, 0.74, 0.58 }, lift = { 0.06, 0.012, 0.006 }, exposure = 0.74, saturation = 1.05 },
        night = { tint = { 0.42, 0.4, 0.72 }, lift = { 0.006, 0.005, 0.03 }, exposure = 0.36, saturation = 0.66 },
    },
    winter = {
        dawn = { tint = { 0.82, 0.9, 1.12 }, lift = { 0.018, 0.024, 0.045 }, exposure = 0.8, saturation = 0.72 },
        noon = { tint = { 0.82, 0.96, 1.12 }, lift = { 0.014, 0.02, 0.035 }, exposure = 0.94, saturation = 0.78 },
        dusk = { tint = { 0.9, 0.78, 1.0 }, lift = { 0.026, 0.014, 0.04 }, exposure = 0.7, saturation = 0.68 },
        night = { tint = { 0.32, 0.4, 0.78 }, lift = { 0.004, 0.008, 0.04 }, exposure = 0.34, saturation = 0.58 },
    },
}

local function clamp(value, minValue, maxValue)
    return math.max(minValue, math.min(maxValue, value))
end

local function smoothstep(edge0, edge1, value)
    local t = clamp((value - edge0) / math.max(0.000001, edge1 - edge0), 0, 1)
    return t * t * (3 - 2 * t)
end

local function mix(a, b, t)
    return a + (b - a) * t
end

local function mixColor(a, b, t)
    return { mix(a[1], b[1], t), mix(a[2], b[2], t), mix(a[3], b[3], t) }
end

local function mixGrade(a, b, t)
    return {
        tint = mixColor(a.tint, b.tint, t),
        lift = mixColor(a.lift, b.lift, t),
        exposure = mix(a.exposure, b.exposure, t),
        saturation = mix(a.saturation, b.saturation, t),
    }
end

local function dayOfYear(state)
    local phase = seasonPhase[state.season or "summer"] or seasonPhase.summer
    return ((phase * 365 + (state.elapsedDays or 0)) % 365) + 1
end

local function solarDeclination(day)
    local gamma = tau / 365 * ((day or 1) - 1)
    return 0.006918 - 0.399912 * math.cos(gamma) + 0.070257 * math.sin(gamma) - 0.006758 * math.cos(2 * gamma) + 0.000907 * math.sin(2 * gamma) - 0.002697 * math.cos(3 * gamma) + 0.00148 * math.sin(3 * gamma)
end

local function twilightName(elevation)
    if elevation >= 0 then return "day" end
    if elevation >= math.rad(-6) then return "civil" end
    if elevation >= math.rad(-12) then return "nautical" end
    if elevation >= math.rad(-18) then return "astronomical" end
    return "night"
end

local function applyWeather(grade, weather)
    if not weather then return grade end
    local cloud = clamp(weather.cloudCover or 0, 0, 1)
    local intensity = clamp(weather.intensity or 0, 0, 1)
    local storm = weather.storm and weather.storm ~= "none"
    local dull = clamp(cloud * 0.22 + intensity * 0.18 + (storm and 0.08 or 0), 0, 0.5)
    return {
        tint = mixColor(grade.tint, { 0.78, 0.84, 0.9 }, cloud * 0.18 + intensity * 0.1),
        lift = mixColor(grade.lift, { 0.018, 0.022, 0.026 }, cloud * 0.4),
        exposure = grade.exposure * (1 - dull),
        saturation = grade.saturation * (1 - clamp(cloud * 0.28 + intensity * 0.18, 0, 0.48)),
    }
end

function Atmosphere.new(options)
    options = options or {}
    local season = options.season or "summer"
    if not seasonIndex[season] then season = "summer" end
    return {
        time = (tonumber(options.time) or 0.25) % 1,
        season = season,
        dayLength = math.max(1, tonumber(options.dayLength) or 60),
        elapsedDays = math.max(0, tonumber(options.elapsedDays) or 0),
        latitudeRadians = tonumber(options.latitudeRadians) or 0,
        dayOfYear = tonumber(options.dayOfYear),
    }
end

function Atmosphere.update(atmosphere, dt)
    if not atmosphere then return nil end
    local absolute = (math.floor(atmosphere.elapsedDays or 0) + (atmosphere.time or 0)) + (dt or 0) / math.max(1, atmosphere.dayLength or 60)
    atmosphere.elapsedDays = math.floor(absolute)
    atmosphere.time = absolute % 1
    return atmosphere
end

function Atmosphere.shiftSeason(atmosphere, delta)
    if not atmosphere then return nil end
    local index = seasonIndex[atmosphere.season] or 2
    index = ((index - 1 + (delta or 0)) % #seasons) + 1
    atmosphere.season = seasons[index]
    return atmosphere.season
end

function Atmosphere.seasons()
    local out = {}
    for index, season in ipairs(seasons) do out[index] = season end
    return out
end

function Atmosphere.dayOfYear(atmosphere)
    return dayOfYear(atmosphere or Atmosphere.new())
end

function Atmosphere.solarState(atmosphere, options)
    local state = atmosphere or Atmosphere.new()
    options = options or {}
    local lat = clamp(tonumber(options.latitudeRadians) or tonumber(state.latitudeRadians) or 0, -math.pi / 2, math.pi / 2)
    local day = tonumber(options.dayOfYear) or tonumber(state.dayOfYear) or dayOfYear(state)
    local decl = solarDeclination(day)
    local solarHour = (((state.time or 0.25) - 0.75) % 1) * 24
    local hourAngle = solarHour / 24 * tau - math.pi
    local sinElev = math.sin(lat) * math.sin(decl) + math.cos(lat) * math.cos(decl) * math.cos(hourAngle)
    local elevation = math.asin(clamp(sinElev, -1, 1))
    return {
        latitudeRadians = lat,
        dayOfYear = day,
        declination = decl,
        hourAngle = hourAngle,
        elevationRadians = elevation,
        elevationDegrees = math.deg(elevation),
        daylight = smoothstep(math.rad(-0.833), math.rad(8), elevation),
        twilight = twilightName(elevation),
    }
end

function Atmosphere.daylightWindow(atmosphere, altitudeDegrees)
    local state = atmosphere or Atmosphere.new()
    local solar = Atmosphere.solarState(state)
    local lat, decl = solar.latitudeRadians, solar.declination
    local denom = math.cos(lat) * math.cos(decl)
    if math.abs(denom) < 0.000001 then return solar.elevationRadians > math.rad(altitudeDegrees or 0) and 24 or 0 end
    local value = (math.sin(math.rad(altitudeDegrees or 0)) - math.sin(lat) * math.sin(decl)) / denom
    if value <= -1 then return 24 end
    if value >= 1 then return 0 end
    return (2 * math.acos(value) / tau) * 24
end

function Atmosphere.moonPhase(atmosphere)
    local state = atmosphere or Atmosphere.new()
    return ((state.elapsedDays or 0) % 29.53) / 29.53
end

function Atmosphere.grade(atmosphere, weather)
    local state = atmosphere or Atmosphere.new()
    local time = (state.time or 0.25) % 1
    local season = seasonIndex[state.season] and state.season or "summer"
    local seasonGrades = grades[season]
    local grade
    for index = 1, #timeKeys - 1 do
        local a, b = timeKeys[index], timeKeys[index + 1]
        if time >= a.time and time <= b.time then
            local span = b.time - a.time
            local t = span > 0 and (time - a.time) / span or 0
            grade = mixGrade(seasonGrades[a.id], seasonGrades[b.id], t)
            break
        end
    end
    grade = grade or seasonGrades.noon
    local solar = Atmosphere.solarState(state)
    local moon = (1 - math.cos(Atmosphere.moonPhase(state) * tau)) * 0.5
    if solar.twilight == "civil" then
        grade.exposure = grade.exposure * 0.88
    elseif solar.twilight == "nautical" then
        grade.exposure = grade.exposure * 0.72
    elseif solar.twilight == "astronomical" then
        grade.exposure = grade.exposure * 0.6
    elseif solar.twilight == "night" then
        grade.exposure = grade.exposure * (0.82 + moon * 0.16)
        grade.lift = mixColor(grade.lift, { 0.008 + moon * 0.012, 0.01 + moon * 0.012, 0.04 + moon * 0.018 }, 0.45)
    end
    return applyWeather(grade, weather or state.weather)
end

function Atmosphere.palette(basePalette, atmosphere, weather)
    local grade = Atmosphere.grade(atmosphere, weather)
    local out = {}
    for index, color in ipairs(basePalette or {}) do
        local gray = (color[1] + color[2] + color[3]) / 3
        local r = gray + (color[1] - gray) * grade.saturation
        local g = gray + (color[2] - gray) * grade.saturation
        local b = gray + (color[3] - gray) * grade.saturation
        out[index] = {
            clamp(r * grade.tint[1] * grade.exposure + grade.lift[1], 0, 1),
            clamp(g * grade.tint[2] * grade.exposure + grade.lift[2], 0, 1),
            clamp(b * grade.tint[3] * grade.exposure + grade.lift[3], 0, 1),
        }
    end
    return out
end

function Atmosphere.paletteKey(atmosphere)
    local state = atmosphere or Atmosphere.new()
    local step = math.floor(((state.time or 0) % 1) * 240 + 0.5)
    local weather = state.weather
    local weatherKey = weather and (tostring(weather.precipitation or "clear") .. ":" .. tostring(weather.storm or "none") .. ":" .. tostring(math.floor((weather.cloudCover or 0) * 8 + 0.5))) or "clear:none:0"
    return tostring(state.season or "summer") .. ":" .. tostring(step) .. ":" .. tostring(math.floor(state.elapsedDays or 0)) .. ":" .. weatherKey
end

function Atmosphere.sunDirection(atmosphere, options)
    local state = atmosphere or Atmosphere.new()
    local solar = Atmosphere.solarState(state, options)
    local lat, decl, ha = solar.latitudeRadians, solar.declination, solar.hourAngle
    local x = -math.sin(ha) * math.cos(solar.elevationRadians)
    local y = math.cos(lat) * math.sin(decl) - math.sin(lat) * math.cos(decl) * math.cos(ha)
    local z = math.max(0.08, math.sin(solar.elevationRadians))
    local length = math.sqrt(x * x + y * y + z * z)
    if length <= 0 then return { x = 0, y = 0, z = 1, daylight = 0 } end
    return {
        x = x / length,
        y = y / length,
        z = z / length,
        daylight = solar.daylight,
        solarElevation = solar.elevationDegrees,
        twilight = solar.twilight,
        moonPhase = Atmosphere.moonPhase(state),
    }
end

function Atmosphere.snapshot(atmosphere)
    return {
        time = atmosphere and atmosphere.time or 0.25,
        season = atmosphere and atmosphere.season or "summer",
        dayLength = atmosphere and atmosphere.dayLength or 60,
        elapsedDays = atmosphere and atmosphere.elapsedDays or 0,
    }
end

return Atmosphere
