local SoilClassify = {}

local ids = {
    none = 0,
    entisol = 1,
    inceptisol = 2,
    mollisol = 3,
    vertisol = 4,
    aridisol = 5,
    histosol = 6,
    spodosol = 7,
    oxisol = 8,
    andisol = 9,
    ultisol = 10,
}

local names = {
    [0] = "none",
    [1] = "entisol",
    [2] = "inceptisol",
    [3] = "mollisol",
    [4] = "vertisol",
    [5] = "aridisol",
    [6] = "histosol",
    [7] = "spodosol",
    [8] = "oxisol",
    [9] = "andisol",
    [10] = "ultisol",
}

local targetDistribution = {
    [1] = 0.237,
    [2] = 0.144,
    [3] = 0.100,
    [4] = 0.035,
    [5] = 0.185,
    [6] = 0.017,
    [7] = 0.038,
    [8] = 0.110,
    [9] = 0.010,
    [10] = 0.124,
}

local function rainfall(cell)
    return cell.rainfall or cell.precipitation or cell.moisture or 0
end

local function age(cell)
    return math.max(cell.plateAge or 0, cell.lithologyAge or 0)
end

local function classify(cell)
    if not cell or cell.water then return ids.none end
    local temp = cell.temperature or 0.5
    local rain = rainfall(cell)
    local slope = cell.slope or 0
    local regolith = cell.regolithDepth or 0
    local soilAge = age(cell)
    local lithology = cell.lithology or 0
    local biome = cell.biome or ""
    local wet = biome == "wetland" or ((cell.flow or 0) > 180 and slope < 0.04 and rain > 0.45)
    if wet and temp < 0.62 then return ids.histosol end
    if cell.isFloodBasalt or (cell.volcanicForm or 0) > 0 or ((cell.hotspotContribution or 0) > 0.12 and lithology == 1) then return ids.andisol end
    if rain < 0.16 or biome == "desert" then return ids.aridisol end
    if regolith < 0.045 or slope > 0.34 or soilAge < 0.08 then return ids.entisol end
    if lithology == 6 and rain > 0.22 and rain < 0.58 and slope < 0.08 then return ids.vertisol end
    if temp > 0.68 and rain > 0.62 and soilAge > 0.45 then return ids.oxisol end
    if temp > 0.48 and rain > 0.56 and soilAge > 0.28 then return ids.ultisol end
    if temp < 0.38 and rain > 0.34 and (biome == "boreal_forest" or biome == "tundra" or lithology == 3) then return ids.spodosol end
    if (biome == "grassland" or biome == "savanna") and rain > 0.22 and rain < 0.62 and slope < 0.16 then return ids.mollisol end
    if regolith > 0.08 and soilAge > 0.12 then return ids.inceptisol end
    return ids.entisol
end

function SoilClassify.ids()
    return ids
end

function SoilClassify.names()
    return names
end

function SoilClassify.targetDistribution()
    return targetDistribution
end

function SoilClassify.classify(cell)
    return classify(cell)
end

function SoilClassify.applyRegion(region)
    local stats = { cells = 0, counts = {} }
    for _, cell in pairs(region.cells or {}) do
        local id = classify(cell)
        cell.soilOrder = id
        if id > 0 then
            stats.cells = stats.cells + 1
            stats.counts[id] = (stats.counts[id] or 0) + 1
        end
    end
    region.soils = stats
    return stats
end

return SoilClassify
