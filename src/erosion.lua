local Erosion = {}
local SoilProduction = require("src.soil_production")

local function option(value, fallback)
    if value == nil then return fallback end
    return value
end

local function clamp(value, minValue, maxValue)
    if value < minValue then return minValue end
    if value > maxValue then return maxValue end
    return value
end

local function debrisEquilibrium(slope, critical, initSlope, depositSlope)
    if slope <= depositSlope then return 0 end
    return math.max(0, critical * (slope - depositSlope) / math.max(0.000001, initSlope - depositSlope))
end

local function orderedCells(region)
    if region.visitOrder then return region.visitOrder end
    local cells = {}
    for _, cell in pairs(region.cells or {}) do cells[#cells + 1] = cell end
    table.sort(cells, function(a, b)
        local ae = a.filledElevation or a.elevation or a.elevationBase or 0
        local be = b.filledElevation or b.elevation or b.elevationBase or 0
        if ae == be then
            if (a.gy or 0) == (b.gy or 0) then return (a.gx or 0) < (b.gx or 0) end
            return (a.gy or 0) < (b.gy or 0)
        end
        return ae < be
    end)
    return cells
end

local function upliftFor(cell, mode)
    if type(mode) == "function" then return mode(cell) or 0 end
    if type(mode) == "number" then return mode end
    if mode == false then return 0 end
    local uplift = math.max(0, cell.uplift or 0)
    local boundary = math.max(0, cell.plateBoundary or 0)
    return uplift * 0.00018 + uplift * boundary * 0.00022
end

local function sedimentCapacity(cell, options)
    local flow = math.max(1, cell.flow or 1)
    local slope = math.max(0.0001, cell.streamPowerSlope or 0)
    return (options.sedimentCapacity or 0.18) * flow * slope
end

local function cellKey(gx, gy)
    return tostring(gx) .. ":" .. tostring(gy)
end

local function gaussianKernel(radius)
    radius = math.max(0, math.floor(radius or 0))
    if radius == 0 then return { [0] = 1 }, 0 end
    local sigma = math.max(0.5, radius * 0.5)
    local kernel, sum = {}, 0
    for offset = -radius, radius do
        local weight = math.exp(-(offset * offset) / (2 * sigma * sigma))
        kernel[offset] = weight
        sum = sum + weight
    end
    for offset = -radius, radius do kernel[offset] = kernel[offset] / sum end
    return kernel, radius
end

local function coordinateIndex(order, region)
    local byY = {}
    local minX, minY, maxX, maxY = region.minX, region.minY, region.maxX, region.maxY
    for _, cell in ipairs(order) do
        local gx, gy = cell.gx, cell.gy
        if gx and gy then
            if not minX or gx < minX then minX = gx end
            if not maxX or gx > maxX then maxX = gx end
            if not minY or gy < minY then minY = gy end
            if not maxY or gy > maxY then maxY = gy end
            local row = byY[gy]
            if not row then
                row = {}
                byY[gy] = row
            end
            row[gx] = cell
        end
    end
    return { byY = byY, minX = minX, minY = minY, maxX = maxX, maxY = maxY }
end

local function applyRebound(index, losses, targetMass, kernel, radius)
    if targetMass <= 0 or not index.minX then return 0, 0 end
    local lossRows = {}
    for cell, loss in pairs(losses) do
        if loss > 0 and cell.gx and cell.gy then
            local row = lossRows[cell.gy]
            if not row then
                row = {}
                lossRows[cell.gy] = row
            end
            row[cell.gx] = loss
        end
    end

    local horizontal = {}
    for gy = index.minY, index.maxY do
        local source = lossRows[gy]
        if source then
            local row, any = {}, false
            for gx = index.minX, index.maxX do
                local value = 0
                for ox = -radius, radius do value = value + (source[gx + ox] or 0) * kernel[ox] end
                if value > 0 then
                    row[gx] = value
                    any = true
                end
            end
            if any then horizontal[gy] = row end
        end
    end

    local rebound, smoothed = {}, 0
    for gy = index.minY, index.maxY do
        local cells = index.byY[gy]
        if cells then
            for gx = index.minX, index.maxX do
                local cell = cells[gx]
                if cell then
                    local value = 0
                    for oy = -radius, radius do
                        local row = horizontal[gy + oy]
                        if row then value = value + (row[gx] or 0) * kernel[oy] end
                    end
                    if value > 0 then
                        rebound[cell] = value
                        smoothed = smoothed + value
                    end
                end
            end
        end
    end
    if smoothed <= 0 then return 0, 0 end

    local scale = targetMass / smoothed
    local added, maxRebound = 0, 0
    for cell, value in pairs(rebound) do
        local delta = value * scale
        cell.elevation = (cell.elevation or cell.elevationBase or 0) + delta
        cell.isostaticRebound = (cell.isostaticRebound or 0) + delta
        added = added + delta
        if delta > maxRebound then maxRebound = delta end
    end
    return added, maxRebound
end

function Erosion.relax(region, options)
    options = options or {}
    local iterations = options.iterations
    if iterations == nil then iterations = 80 end
    iterations = math.max(0, math.floor(iterations))
    local order = orderedCells(region)
    local k = options.K or 0.0006
    local m = options.m or 0.5
    local n = options.n or 1.0
    local dt = options.dt or 1.0
    local upliftMode = options.uplift
    if upliftMode == nil then upliftMode = "plateBased" end
    local seaLevel = region.seaLevel or -math.huge
    local minSlope = options.minSlope or 0.00002
    local isostasy = option(options.isostasy, true)
    local isostasyRatio = isostasy and option(options.isostasyRatio, 0.8) or 0
    local kernel, isostasyRadius = gaussianKernel(option(options.isostasyRadius, 4))
    local index = isostasyRatio > 0 and coordinateIndex(order, region) or nil
    local maxDelta = 0
    local isostaticErosion, isostaticRebound = 0, 0
    local fluvialK = option(options.debrisFluvialK, k)
    local debrisK = option(options.debrisK, 5e-4)
    local debrisBeta = option(options.debrisBeta, 2)
    local criticalConcentration = option(options.debrisCriticalConcentration, 0.4)
    local initSlope = option(options.debrisInitSlope, 0.3)
    local depositSlope = option(options.debrisDepositSlope, 0.1)
    local debrisSedimentYield = option(options.debrisSedimentYield, options.sedimentYield or 1.0)
    local debrisTransfer = option(options.debrisTransfer, 0.985)
    local maxDebrisDeposit = option(options.maxDebrisDeposit, 0.08)

    for _, cell in ipairs(order) do
        cell.elevationBase = cell.elevationBase or cell.elevation or 0
        cell.elevation = cell.elevation or cell.elevationBase
        cell.isostaticErosion = 0
        cell.isostaticRebound = 0
        cell.debrisFlow = false
        cell.debrisFlowDelta = 0
    end

    for _ = 1, iterations do
        maxDelta = 0
        local losses, eroded = {}, 0
        for _, cell in ipairs(order) do
            cell.sedimentFlux = 0
        end
        for index = #order, 1, -1 do
            local cell = order[index]
            local down = cell.downCell
            if down and not cell.water then
                local old = cell.elevation or cell.elevationBase or 0
                local downElevation = down.elevation or down.elevationBase or old
                local distance = math.max(1, cell.downDistance or region.stride or 1)
                local area = math.max(0.01, cell.flow or 0.01)
                local slope = math.max(0, (old - downElevation) / distance)
                local flow = math.max(1, cell.flow or 1)
                local flux = math.max(0, cell.sedimentFlux or 0)
                local concentration = flux / flow
                local erodibility = cell.erodibilityK or 1
                local debris = concentration > criticalConcentration
                local incisionK = debris and debrisK or fluvialK
                local incision = debris
                    and (incisionK * flow * (slope ^ debrisBeta) * dt * erodibility)
                    or (incisionK * (area ^ m) * (math.max(slope, minSlope) ^ n) * dt * erodibility)
                incision = math.min(incision, math.max(0, 0.5 * distance * slope))
                local equilibrium = debrisEquilibrium(slope, criticalConcentration, initSlope, depositSlope)
                local deposit = 0
                if concentration > criticalConcentration and concentration > equilibrium then
                    local length = math.max(1, option(options.debrisDepositLength, 10 * distance))
                    deposit = (flux - equilibrium * flow) / length * dt
                    deposit = clamp(deposit, 0, maxDebrisDeposit)
                    flux = math.max(0, flux - deposit * distance * distance)
                end
                local uplift = upliftFor(cell, upliftMode) * dt
                local nextElevation = old + uplift - incision + deposit
                local gradeFloor = downElevation + minSlope * distance
                if old >= gradeFloor then nextElevation = math.max(nextElevation, gradeFloor) end
                nextElevation = math.min(nextElevation, old + uplift + deposit)
                nextElevation = math.max(nextElevation, seaLevel - 0.08)
                local netIncision = math.max(0, old + uplift - nextElevation)
                if isostasyRatio > 0 and netIncision > 0 then
                    losses[cell] = netIncision
                    cell.isostaticErosion = (cell.isostaticErosion or 0) + netIncision
                    eroded = eroded + netIncision
                end
                local delta = math.abs(nextElevation - old)
                if delta > maxDelta then maxDelta = delta end
                cell.elevation = nextElevation
                local debrisDelta = deposit - netIncision
                cell.debrisFlowDelta = (cell.debrisFlowDelta or 0) + debrisDelta
                if debris then cell.debrisFlow = true end
                if down then
                    local source = netIncision * flow * debrisSedimentYield
                    down.sedimentFlux = (down.sedimentFlux or 0) + math.max(0, flux + source) * debrisTransfer
                end
            end
        end
        if isostasyRatio > 0 and eroded > 0 then
            local rebound, maxRebound = applyRebound(index, losses, eroded * isostasyRatio, kernel, isostasyRadius)
            isostaticErosion = isostaticErosion + eroded
            isostaticRebound = isostaticRebound + rebound
            if maxRebound > maxDelta then maxDelta = maxRebound end
        end
    end

    local erosionSum, upliftSum, maxErosion, debrisFlowCells = 0, 0, 0, 0
    for _, cell in ipairs(order) do
        local base = cell.elevationBase or 0
        local elevation = cell.elevation or base
        local delta = elevation - base
        local erosion = math.max(0, -delta)
        local uplift = math.max(0, delta)
        cell.streamPowerDelta = delta
        cell.streamPowerErosion = erosion
        cell.streamPowerUplift = uplift
        if cell.downCell then
            local distance = math.max(1, cell.downDistance or region.stride or 1)
            cell.streamPowerSlope = math.max(0, (elevation - (cell.downCell.elevation or cell.downCell.elevationBase or elevation)) / distance)
        else
            cell.streamPowerSlope = 0
        end
        SoilProduction.syncCell(cell)
        if cell.debrisFlow then debrisFlowCells = debrisFlowCells + 1 end
        erosionSum = erosionSum + erosion
        upliftSum = upliftSum + uplift
        if erosion > maxErosion then maxErosion = erosion end
    end

    local sedimentSum, maxSediment = 0, 0
    local sedimentYield = options.sedimentYield or 1.0
    local depositionG = options.G or 1.2
    local transfer = options.sedimentTransfer or 0.985
    local maxDeposit = options.maxDeposit or 0.06
    for _, cell in ipairs(order) do
        cell.sediment = 0
        cell.sedimentFlux = 0
        cell.sedimentCapacity = 0
    end
    for index = #order, 1, -1 do
        local cell = order[index]
        if not cell.water then
            local flow = math.max(1, cell.flow or 1)
            local source = (cell.streamPowerErosion or 0) * flow * sedimentYield
            local flux = (cell.sedimentFlux or 0) + source
            local capacity = sedimentCapacity(cell, options)
            local deposit = 0
            if flux > capacity then
                local excess = flux - capacity
                deposit = math.min(excess, depositionG * flux / flow)
                deposit = math.min(deposit, maxDeposit)
                flux = flux - deposit
            end
            cell.sediment = deposit
            cell.sedimentFlux = flux
            cell.sedimentCapacity = capacity
            sedimentSum = sedimentSum + deposit
            if deposit > maxSediment then maxSediment = deposit end
            if cell.downCell then
                cell.downCell.sedimentFlux = (cell.downCell.sedimentFlux or 0) + flux * transfer
            end
        end
    end

    return {
        iterations = iterations,
        maxDelta = maxDelta,
        meanErosion = erosionSum / math.max(1, #order),
        meanUplift = upliftSum / math.max(1, #order),
        maxErosion = maxErosion,
        isostaticErosion = isostaticErosion,
        isostaticRebound = isostaticRebound,
        meanSediment = sedimentSum / math.max(1, #order),
        maxSediment = maxSediment,
        debrisFlowCells = debrisFlowCells,
    }
end

function Erosion.glaciate(region, options)
    options = options or {}
    local order = orderedCells(region)
    local freeze = options.freezeTemperature or 0.38
    local snowline = options.snowline
    local maxCut = options.maxCut or 0.075
    local cells = region.cells or {}
    local seaLevel = option(options.seaLevel, region.seaLevel or -math.huge)
    local beta = option(options.beta, 0.008)
    local bmax = option(options.bmax, 2)
    local gamma = option(options.normalizedGamma, option(options.Gamma, 4.4e-9) * 8e11)
    local kg = option(options.Kg, 5e-5)
    local slidingFraction = option(options.slidingFraction, 0.5)
    local accumulationRate = option(options.normalizedBeta, beta * 80)
    local accumulationMax = option(options.accumulationMax, math.min(0.18, bmax * 0.08))
    local ablationMax = option(options.ablationMax, 0.12)
    local erosionScale = option(options.erosionScale, 1600)
    local minIce = option(options.minIceThickness, 0.0005)
    local initialIceScale = option(options.initialIceScale, 0.06)
    local dt = option(options.dt, math.max(1, (options.geologicTimeStep or 0) * 20))
    local iterations = math.max(1, math.floor(option(options.siaIterations, 3)))
    local dx = math.max(0.000001, option(options.dx, math.max(1, region.stride or 1) * math.max(1, region.scaleFactor or 1)))
    local subdt = dt / iterations
    local iceState = options.iceState or {}
    local nextIceState = {}
    local indexByCell, bed, ice, marine, maxVelocity, slopeMax = {}, {}, {}, {}, {}, {}
    local faces = { { x = 1, y = 0, distance = 1 }, { x = 0, y = 1, distance = 1 } }

    local function surfaceBase(cell)
        return cell.elevationBase or cell.elevation or cell.bedrockElevation or 0
    end

    local function bedrock(cell)
        return cell.bedrockElevation or surfaceBase(cell) - math.max(0, cell.regolithDepth or 0)
    end

    local function cellIceKey(cell)
        return cellKey(cell.gx or 0, cell.gy or 0)
    end

    local function elaFor(cell)
        if snowline then return snowline end
        local latitudeUnit = math.min(1, math.abs(cell.latitudeRadians or 0) / (math.pi / 2))
        return 0.55 + 0.04 * (1 - latitudeUnit)
    end

    local function isAccumulationCell(cell)
        return not cell.water and (cell.temperature or 1) < freeze and surfaceBase(cell) > elaFor(cell)
    end

    local function smbFor(cell, h)
        if cell.water or bedrock(cell) <= seaLevel then return -ablationMax end
        if (cell.temperature or 1) >= freeze then return -ablationMax * clamp(((cell.temperature or freeze) - freeze) / math.max(0.000001, 1 - freeze), 0, 1) end
        return clamp(accumulationRate * (h - elaFor(cell)), -ablationMax, accumulationMax)
    end

    for index, cell in ipairs(order) do
        indexByCell[cell] = index
        local zBed = bedrock(cell)
        bed[index] = zBed
        marine[index] = cell.water or zBed <= seaLevel
        cell.glaciated = false
        cell.glacialDelta = 0
        cell.glacialErosion = 0
        maxVelocity[index] = 0
        slopeMax[index] = 0
        if marine[index] then
            ice[index] = 0
        else
            ice[index] = math.max(0, iceState[cellIceKey(cell)] or cell.iceThickness or 0)
            if ice[index] <= 0 and isAccumulationCell(cell) then
                local ela = elaFor(cell)
                local excess = math.max(0, surfaceBase(cell) - ela) / math.max(0.000001, 1 - ela)
                ice[index] = initialIceScale * excess ^ 0.375
            end
        end
    end

    for _ = 1, iterations do
        local delta = {}
        for index, cell in ipairs(order) do
            local h = bed[index] + ice[index]
            delta[index] = smbFor(cell, h) * subdt
        end
        for index, cell in ipairs(order) do
            for _, offset in ipairs(faces) do
                local neighbor = cells[cellKey((cell.gx or 0) + offset.x, (cell.gy or 0) + offset.y)]
                local nIndex = neighbor and indexByCell[neighbor]
                if nIndex then
                    local hFace = 0.5 * (ice[index] + ice[nIndex])
                    if hFace > minIce then
                        local faceDx = dx * offset.distance
                        local surfaceA = bed[index] + ice[index]
                        local surfaceB = bed[nIndex] + ice[nIndex]
                        local slope = (surfaceB - surfaceA) / faceDx
                        local q = -gamma * hFace ^ 5 * math.abs(slope) ^ 2 * slope
                        local source = q >= 0 and index or nIndex
                        local limit = ice[source] * 0.45 * faceDx / math.max(subdt, 0.000001)
                        if q > limit then q = limit elseif q < -limit then q = -limit end
                        local transfer = q * subdt / faceDx
                        delta[index] = delta[index] - transfer
                        delta[nIndex] = delta[nIndex] + transfer
                        local ub = slidingFraction * math.abs(q) / math.max(hFace, minIce)
                        if ub > maxVelocity[index] then maxVelocity[index] = ub end
                        if ub > maxVelocity[nIndex] then maxVelocity[nIndex] = ub end
                        local slopeAbs = math.abs(slope)
                        if slopeAbs > slopeMax[index] then slopeMax[index] = slopeAbs end
                        if slopeAbs > slopeMax[nIndex] then slopeMax[nIndex] = slopeAbs end
                    end
                end
            end
        end
        for index = 1, #order do
            if marine[index] then
                ice[index] = 0
            else
                ice[index] = math.max(0, ice[index] + delta[index])
            end
        end
    end

    local count, erosionSum, iceVolume = 0, 0, 0
    for index, cell in ipairs(order) do
        local h = ice[index]
        local primary = h > minIce and isAccumulationCell(cell)
        local velocity = maxVelocity[index] or 0
        local abrasion = kg * erosionScale * velocity * velocity * dt
        local pluck = h > minIce and math.min(maxCut * 0.35, h * math.min(1, slopeMax[index] or 0) * 0.08) or 0
        local cut = (not cell.water and h > minIce) and math.min(maxCut, abrasion + pluck) or 0
        if cut > 0 then
            local old = cell.elevation or cell.elevationBase or 0
            cell.elevation = old - cut
            cell.glacialDelta = -cut
            cell.glacialErosion = cut
            SoilProduction.syncCell(cell)
            erosionSum = erosionSum + cut
        else
            SoilProduction.syncCell(cell)
        end
        cell.iceThickness = h
        cell.glaciated = primary
        if primary then count = count + 1 end
        iceVolume = iceVolume + h
        nextIceState[cellIceKey(cell)] = h
    end

    region.glaciers = {
        glaciatedCells = count,
        meanGlacialErosion = erosionSum / math.max(1, #order),
        iceVolume = iceVolume,
        iceState = nextIceState,
    }
    return region.glaciers
end

return Erosion
