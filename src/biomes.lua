local Biomes = {}

local bins = 16
local grid = {}

local function clamp(value, minValue, maxValue)
    if value < minValue then return minValue end
    if value > maxValue then return maxValue end
    return value
end

local function terrestrialBiome(temperature, precipitation)
    if temperature < 0.12 and precipitation < 0.18 then return "polar_desert" end
    if temperature < 0.2 then
        if precipitation > 0.52 then return "boreal_forest" end
        return "tundra"
    end
    if temperature < 0.48 and precipitation < 0.18 then return "cold_desert" end
    if temperature < 0.34 and precipitation > 0.68 then return "muskeg" end
    if temperature < 0.38 then
        if precipitation < 0.28 then return "tundra" end
        if precipitation < 0.54 then return "grassland" end
        return "boreal_forest"
    end
    if temperature < 0.62 and precipitation > 0.76 then return "temperate_rainforest" end
    if temperature < 0.62 then
        if precipitation < 0.18 then return "cold_desert" end
        if precipitation < 0.24 then return "desert" end
        if precipitation < 0.34 then return "semiarid_shrubland" end
        if precipitation < 0.48 then return "grassland" end
        return "temperate_forest"
    end
    if precipitation < 0.2 then return "desert" end
    if precipitation < 0.32 then return "thorn_scrub" end
    if precipitation < 0.42 then return "savanna" end
    if precipitation < 0.58 then return "dry_broadleaf" end
    if precipitation < 0.74 then return "monsoon_forest" end
    return "rainforest"
end

local function latitudeUnit(cell)
    return math.min(1, math.abs(cell.latitudeRadians or 0) / (math.pi / 2))
end

local function forestBiome(biome)
    return biome == "temperate_forest"
        or biome == "rainforest"
        or biome == "boreal_forest"
        or biome == "temperate_rainforest"
        or biome == "cloud_forest"
        or biome == "monsoon_forest"
        or biome == "dry_broadleaf"
        or biome == "mixed_forest"
        or biome == "conifer_forest"
end

for t = 1, bins do
    grid[t] = {}
    local temperature = (t - 0.5) / bins
    for p = 1, bins do
        local precipitation = (p - 0.5) / bins
        grid[t][p] = terrestrialBiome(temperature, precipitation)
    end
end

function Biomes.koppen(temperature, precipitation, cell)
    temperature = clamp(temperature or 0.5, 0, 1)
    precipitation = clamp(precipitation or 0.5, 0, 1)
    local latUnit = cell and latitudeUnit(cell) or 0
    local monsoon = cell and (cell.monsoonIndex or 0) or 0
    if temperature < 0.12 then return "EF" end
    if temperature < 0.2 then return "ET" end
    if precipitation < 0.16 then return temperature > 0.58 and "BWh" or "BWk" end
    if precipitation < 0.32 then return temperature > 0.52 and "BSh" or "BSk" end
    if temperature > 0.66 then
        if precipitation > 0.74 then return "Af" end
        if precipitation > 0.52 or monsoon > 0.25 then return "Am" end
        return "Aw"
    end
    if temperature > 0.38 then
        local drySummer = latUnit > 0.27 and latUnit < 0.5 and monsoon < 0.16 and precipitation < 0.52
        if drySummer then return temperature > 0.58 and "Csa" or "Csb" end
        return temperature > 0.58 and "Cfa" or "Cfb"
    end
    return precipitation < 0.44 and "Dwb" or "Dfb"
end

function Biomes.lookup(temperature, precipitation, elevation, water, slope, hotspotContribution, isFloodBasalt, karstType, reefStage, allowExotic, cell)
    temperature = clamp(temperature or 0.5, 0, 1)
    precipitation = clamp(precipitation or 0.5, 0, 1)
    elevation = elevation or 0
    slope = slope or 0
    if (reefStage or 0) == 4 then return "lagoon" end
    if (reefStage or 0) == 2 then return "atoll_ring" end
    if (reefStage or 0) == 1 then return "seamount_cap" end
    if (reefStage or 0) == 3 then return "reef" end
    if water then
        if elevation > -0.035 and temperature > 0.62 and precipitation > 0.52 then return "mangrove" end
        if elevation > -0.06 and temperature < 0.48 then return "kelp_forest_fringe" end
        if elevation > -0.06 then return "coast" end
        if elevation > -0.12 and temperature > 0.6 then return "seamount_cap" end
        if elevation > -0.2 and temperature > 0.62 and precipitation > 0.66 then return "atoll_ring" end
        return "ocean"
    end
    if isFloodBasalt then return "lava_flow" end
    if (karstType or 0) > 0 then return "karst" end
    if allowExotic and temperature > 0.74 and precipitation > 0.88 and elevation < 0.22 then return "bioluminescent_grove" end
    if allowExotic and temperature < 0.16 and elevation > 0.62 then return "blue_ice_field" end
    if allowExotic and precipitation < 0.1 and elevation < 0.22 and slope < 0.04 then return "salt_cathedral" end
    if (hotspotContribution or 0) > 0.25 and slope < 0.2 then return "shield" end
    if cell and (cell.volcanicForm or 0) == 2 and precipitation > 0.44 then return "hot_spring_travertine" end
    if cell and (cell.volcanicForm or 0) > 0 and precipitation < 0.28 then return "ash_plain" end
    if cell and (cell.hotspotContribution or 0) > 0.18 and slope < 0.12 and temperature > 0.42 then return "fumarole_field" end
    if cell and (cell.periglacialFeature or 0) == 3 then return "permafrost_polygon" end
    if elevation > 0.86 and temperature < 0.28 then return "nival_zone" end
    if elevation > 0.64 and slope > 0.16 and temperature < 0.48 then return "alpine_scree" end
    if elevation > 0.72 then return temperature < 0.35 and "snow" or "rock" end
    if slope > 0.18 and elevation > 0.45 then return temperature < 0.42 and "subalpine_krummholz" or "alpine" end
    if elevation > 0.36 and temperature > 0.58 and precipitation > 0.74 then return "cloud_forest" end
    if temperature < 0.14 and precipitation >= 0.18 then return "snow" end
    if precipitation > 0.82 and elevation < 0.12 then return "wetland" end
    if cell and (cell.playa or (precipitation < 0.12 and slope < 0.04 and elevation < 0.16)) then return "playa_salt_flat" end
    if precipitation < 0.28 and slope > 0.16 and elevation > 0.12 then return "badland" end
    local t = clamp(math.floor(temperature * bins) + 1, 1, bins)
    local p = clamp(math.floor(precipitation * bins) + 1, 1, bins)
    return grid[t][p]
end

function Biomes.refineCell(cell, allowExotic)
    if not cell then return nil end
    cell.treeline = 0
    cell.riparian = 0
    cell.fireFrequency = 0
    cell.biomeSecondary = nil
    if cell.water then return cell.biome end
    allowExotic = allowExotic or cell.allowExoticBiomes == true
    local biome = cell.biome or Biomes.lookup(cell.temperature, cell.rainfall or cell.precipitation, cell.elevation, cell.water, cell.slope, cell.hotspotContribution, cell.isFloodBasalt, cell.karstType, cell.reefStage, allowExotic, cell)
    local temperature = clamp(cell.temperature or 0.5, 0, 1)
    local precipitation = clamp(cell.rainfall or cell.precipitation or cell.moisture or 0.5, 0, 1)
    local elevation = cell.elevation or cell.elevationBase or 0
    local latUnit = latitudeUnit(cell)
    local gdd = temperature * (1 - latUnit) * 4000
    local wind = math.sqrt((cell.windX or 0) * (cell.windX or 0) + (cell.windY or 0) * (cell.windY or 0))
    if elevation > 0.38 and (gdd < 1100 or wind > 0.9) and forestBiome(biome) then
        cell.treeline = 1
        biome = temperature < 0.3 and "tundra" or "subalpine_krummholz"
    end
    if not cell.water and cell.riverBank then
        cell.riparian = 1
        if precipitation < 0.22 then
            biome = "oasis"
        elseif precipitation < 0.34 and (biome == "desert" or biome == "grassland" or biome == "savanna" or biome == "thorn_scrub" or biome == "semiarid_shrubland") then
            biome = "riparian_gallery_forest"
        end
    end
    local latDegrees = latUnit * 90
    local summerDry = latDegrees >= 25 and latDegrees <= 45 and (cell.monsoonIndex or 0) < 0.15 and temperature > 0.42
    if summerDry then
        cell.fireFrequency = clamp((0.58 - precipitation) * 1.6 + (temperature - 0.42) * 0.35, 0, 1)
        if cell.fireFrequency > 0.3 and forestBiome(biome) then biome = temperature > 0.6 and "savanna" or "mediterranean_chaparral" end
    end
    if (cell.duneAmplitude or 0) > 0.02 and (biome == "desert" or biome == "thorn_scrub") then biome = "dune_sea_erg" end
    if (cell.coastBeach or cell.delta) and temperature > 0.66 and precipitation > 0.55 then biome = "mangrove" end
    if biome == "monsoon_forest" or biome == "rainforest" or biome == "temperate_forest" then
        if elevation > 0.32 and precipitation > 0.62 then
            biome = "cloud_forest"
        elseif (cell.rainShadowScore or 0) > 0.18 and temperature > 0.58 then
            biome = "dry_broadleaf"
        elseif (cell.lithology or 0) == 6 and precipitation > 0.48 then
            biome = "mixed_forest"
        elseif (cell.slope or 0) > 0.14 and elevation > 0.18 then
            biome = "conifer_forest"
        end
    end
    if biome == "savanna" and precipitation < 0.3 then biome = "thorn_scrub" end
    if biome == "grassland" and precipitation < 0.34 then biome = "semiarid_shrubland" end
    if allowExotic and cell.coastBeach and temperature > 0.62 and precipitation > 0.52 then biome = "red_algal_shore" end
    if allowExotic and biome == "snow" and elevation > 0.72 and temperature < 0.2 then biome = "blue_ice_field" end
    if biome ~= "ocean" and biome ~= "coast" and biome ~= "river" and biome ~= "lake" then
        local warm = terrestrialBiome(clamp(temperature + 0.05, 0, 1), precipitation)
        local wet = terrestrialBiome(temperature, clamp(precipitation + 0.08, 0, 1))
        local secondary = warm ~= biome and warm or (wet ~= biome and wet or nil)
        cell.biomeSecondary = secondary
    end
    cell.biome = biome
    return biome
end

function Biomes.grid()
    return grid
end

return Biomes
