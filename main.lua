package.path = "./?.lua;./?/init.lua;./src/?.lua;./src/?/init.lua;" .. package.path

local Player = require("src.player")
local Atmosphere = require("src.atmosphere")
local Export = require("src.export")
local Game = require("src.game")
local Journal = require("src.journal")
local Menu = require("src.menu")
local PostFX = require("src.postfx")
local Render = require("src.render")
local Save = require("src.save")
local Settings = require("src.settings")
local Survey = require("src.survey")
local Thumbnail = require("src.thumbnail")
local ViewScale = require("src.viewscale")
local Weather = require("src.weather")
local WorldGen = require("src.worldgen")
local Keybinds = require("src.keybinds")

local app
local terrainPreloadPadding = 0
local billboardPreloadPadding = 0
local preloadStride = 64
local maxSimDt = 1 / 30

local function now()
    return love.timer and love.timer.getTime and love.timer.getTime() or os.clock()
end

local function msSince(startTime)
    return (now() - startTime) * 1000
end

local function flag(value)
    return value and "1" or "0"
end

local function cameraZoom(camera)
    return Render.clampZoom(camera and camera.zoom or 1)
end

local function perfLine(app, message)
    if app and app.debugPerf then print("[perf] " .. message) end
end

local featureRank = { mountain_range = 1, watershed = 2, basin = 3 }

local elevationZoneLabels = {
    montane = "Montane Zone",
    subalpine = "Subalpine Zone",
    alpine = "Alpine Zone",
    nival = "Nival Zone",
}

local function elevationZone(cell)
    if not cell or cell.water then return nil end
    local biome = cell.biome
    local elevation = cell.elevation or 0
    if biome == "nival_zone" or (biome == "snow" and elevation > 0.72) then return "nival" end
    if biome == "alpine" or biome == "alpine_scree" or (biome == "rock" and elevation > 0.64) then return "alpine" end
    if biome == "subalpine_krummholz" or (elevation > 0.48 and (cell.temperature or 0.5) < 0.48) then return "subalpine" end
    if elevation > 0.28 then return "montane" end
    return "lowland"
end

local function currentFeature(app, cell)
    local best
    for _, item in ipairs(app.world:discoveriesAt(cell.x, cell.y, "local")) do
        local rank = featureRank[item.kind]
        if rank and (not best or rank < best.rank) then
            best = { kind = item.kind, id = item.id, name = item.name, rank = rank }
        end
    end
    return best
end

local function areaKey(area)
    return table.concat({
        area and area.featureKey or "",
        area and area.biome or "",
        area and area.koppen or "",
        area and area.elevationZone or "",
    }, "|")
end

local function areaSnapshot(app, cell, biome)
    local feature = currentFeature(app, cell)
    local zone = elevationZone(cell)
    return {
        biome = biome,
        biomeLabel = Render.biomeDisplayName(biome),
        koppen = cell.koppen or app.currentKoppen or "??",
        elevationZone = zone,
        elevationZoneLabel = elevationZoneLabels[zone],
        feature = feature,
        featureName = feature and feature.name or nil,
        featureKey = feature and (feature.kind .. ":" .. tostring(feature.id)) or nil,
    }
end

local function updateCurrentArea(app, area, dt)
    local key = areaKey(area)
    if not app.currentArea then
        app.currentArea = area
        app.currentAreaKey = key
        app.pendingArea = nil
        return false, nil
    end
    if key == app.currentAreaKey then
        app.pendingArea = nil
        return false, app.currentArea
    end
    if not app.pendingArea or app.pendingArea.key ~= key then
        app.pendingArea = { key = key, area = area, age = 0 }
        return false, app.currentArea
    end
    app.pendingArea.age = app.pendingArea.age + (dt or 0)
    if app.pendingArea.age < (app.areaDebounce or 0.25) then return false, app.currentArea end
    local previous = app.currentArea
    app.currentArea = app.pendingArea.area
    app.currentAreaKey = app.pendingArea.key
    app.pendingArea = nil
    return true, previous
end

local function bannerSecondary(current, previous)
    if current.featureKey ~= (previous and previous.featureKey) and current.featureName then return current.featureName end
    if current.elevationZone ~= (previous and previous.elevationZone) and current.elevationZoneLabel then return current.elevationZoneLabel end
    if current.koppen ~= (previous and previous.koppen) then return "Koppen " .. tostring(current.koppen) end
    return nil
end

local function updateBiomeBanner(app, dt)
    local cell = app.world:sample(math.floor(app.player.x), math.floor(app.player.y), "local")
    local biome = cell and not cell.pendingHydrology and cell.biome
    if biome then
        local changed, previous = updateCurrentArea(app, areaSnapshot(app, cell, biome), dt)
        app.currentBiome = app.currentArea and app.currentArea.biome or biome
        if changed and app.showAreaLabels ~= false then
            app.biomeBanner = {
                biome = app.currentArea.biome,
                label = app.currentArea.biomeLabel,
                secondary = bannerSecondary(app.currentArea, previous),
                age = 0,
                duration = 3.0,
                fade = 0.75,
            }
        end
    end
    if app.biomeBanner then
        app.biomeBanner.age = (app.biomeBanner.age or 0) + dt
        if app.biomeBanner.age >= (app.biomeBanner.duration or 0) then app.biomeBanner = nil end
    end
end

local function frustumRadius(app)
    local renderRadius = (app.camera.renderRadius or 62) / cameraZoom(app.camera)
    return math.ceil(math.sqrt(renderRadius * renderRadius + (renderRadius * 0.82) * (renderRadius * 0.82)))
end

local function chunkRange(app, radius, scaleId)
    local size = app.world:metadata().chunkSize
    local info = WorldGen.scaleInfo(scaleId)
    local minGX = math.floor((app.player.x - radius) / (info.factor or 1))
    local maxGX = math.floor((app.player.x + radius) / (info.factor or 1))
    local minGY = math.floor((app.player.y - radius) / (info.factor or 1))
    local maxGY = math.floor((app.player.y + radius) / (info.factor or 1))
    return math.floor(minGX / size),
        math.floor(maxGX / size),
        math.floor(minGY / size),
        math.floor(maxGY / size)
end

local function hasArg(args, value)
    for _, arg in ipairs(args or {}) do
        if arg == value then return true end
    end
    return false
end

local function argValue(args, flag, fallback)
    for index, arg in ipairs(args or {}) do
        if arg == flag then return args[index + 1] or fallback end
    end
    return fallback
end

local function runtimeWorldOptions(args)
    return {
        scope = WorldGen.validScope(argValue(args, "--scope", "local")),
        allowExoticBiomes = hasArg(args, "--allow-exotic-biomes"),
        hydrologyRegionChunks = tonumber(argValue(args, "--hydrology-region-chunks", 1)) or 1,
        hydrologyHaloCells = tonumber(argValue(args, "--hydrology-halo", 0)) or 0,
        hydrologyBasinChunks = tonumber(argValue(args, "--hydrology-basin-chunks", 8)) or 8,
        hydrologyBasinStride = tonumber(argValue(args, "--hydrology-basin-stride", 8)) or 8,
        hydrologyBasinHaloCells = tonumber(argValue(args, "--hydrology-basin-halo", 0)) or 0,
        hydrologyBasinFlowScale = tonumber(argValue(args, "--hydrology-basin-flow-scale", 0.6)) or 0.6,
        cacheMaxEntries = tonumber(argValue(args, "--cache-max-entries", 512)) or 512,
        geologicTime = tonumber(argValue(args, "--geologic-time", 0)) or 0,
        geologicTimeStep = tonumber(argValue(args, "--geologic-time-step", nil)),
    }
end

local function startAsyncHydrology(app)
    if app.asyncHydrology and app.world.startAsyncHydrology then app.world:startAsyncHydrology(app.worldOptions) end
end

local function updateWeather(app, dt)
    if not (app and app.world and app.viewScale) then return nil end
    Weather.update(app.weatherRuntime, dt or 0)
    local params = ViewScale.params(app.viewScale, app.world)
    local cell = app.world:sample(math.floor(app.player.x), math.floor(app.player.y), params.target)
    local bucket = app.weatherRuntime and app.weatherRuntime.fixedBucket or Weather.bucketFor(app.weatherRuntime and app.weatherRuntime.clock or 0)
    app.weatherClock = app.weatherRuntime and app.weatherRuntime.clock or 0
    app.weatherState = Weather.sample(app.world, cell, {
        x = app.player.x,
        y = app.player.y,
        bucket = bucket,
        scale = params.target,
    })
    app.currentKoppen = cell and cell.koppen or app.weatherState.koppen
    app.weatherAudioCue = app.weatherState.audioCue
    if app.atmosphere then
        app.atmosphere.latitudeRadians = cell and cell.latitudeRadians or app.atmosphere.latitudeRadians or 0
        app.atmosphere.weather = app.weatherState
    end
    return app.weatherState
end

local function exitApp(app)
    if app and app.world and app.world.shutdownAsyncHydrology then app.world:shutdownAsyncHydrology(false) end
    love.event.quit(0)
end

local function replaceWorld(app, seed)
    if app.world and app.world.shutdownAsyncHydrology then app.world:shutdownAsyncHydrology(false) end
    app.world = WorldGen.new(seed, app.worldOptions)
    app.currentBiome = nil
    app.currentArea = nil
    app.currentAreaKey = nil
    app.pendingArea = nil
    app.biomeBanner = nil
    startAsyncHydrology(app)
end

local function exportMap(args)
    local output = argValue(args, "--export-map", "thoth-map")
    local world = WorldGen.new(tonumber(argValue(args, "--seed", 20260625)), runtimeWorldOptions(args))
    local map = Export.renderMap(world, {
        size = tonumber(argValue(args, "--export-size", 128)) or 128,
        span = tonumber(argValue(args, "--export-span", 512)) or 512,
        scale = argValue(args, "--export-scale", "local"),
        x = tonumber(argValue(args, "--export-x", 0)) or 0,
        y = tonumber(argValue(args, "--export-y", 0)) or 0,
    })
    local imageData = love.image.newImageData(map.size, map.size)
    local index = 1
    for y = 0, map.size - 1 do
        for x = 0, map.size - 1 do
            local r, g, b = string.byte(map.pixels[index], 1, 3)
            imageData:setPixel(x, y, r / 255, g / 255, b / 255, 1)
            index = index + 1
        end
    end
    local fileData = imageData:encode("png")
    local image = assert(io.open(output .. ".png", "wb"))
    image:write(fileData:getString())
    image:close()
    Export.writeMetadata(output .. ".json", map.metadata)
    print("export-map=" .. output)
    print("export-seed=" .. tostring(map.metadata.seed))
    print("export-size=" .. tostring(map.size))
    love.event.quit(0)
end

local function smoke(args)
    local world = WorldGen.new(tonumber(argValue(args, "--seed", 20260625)))
    local player = Player.new(0, 0)
    local renderStats = Render.visibleStats({ world = world, player = player, camera = Render.defaultCamera() }, 1280, 720)
    local totals = { land = 0, water = 0, river = 0, talus = 0, alluvial = 0, fanLobe = 0, floodplain = 0, delta = 0, braided = 0, terrace = 0, playa = 0, sinkhole = 0, chunks = 0 }
    for _, scale in ipairs(world:metadata().scales) do
        for cy = -1, 1 do
            for cx = -1, 1 do
                local chunk = world:chunk(cx, cy, scale.id)
                totals.chunks = totals.chunks + 1
                for y = 1, chunk.size do
                    local row = chunk.cells[y]
                    for x = 1, chunk.size do
                        local cell = row[x]
                        if cell.water then totals.water = totals.water + 1 else totals.land = totals.land + 1 end
                        if cell.river then totals.river = totals.river + 1 end
                        if cell.talus then totals.talus = totals.talus + 1 end
                        if cell.alluvialFan then totals.alluvial = totals.alluvial + 1 end
                        if cell.alluvialFanLobe then totals.fanLobe = totals.fanLobe + 1 end
                        if cell.floodplain then totals.floodplain = totals.floodplain + 1 end
                        if cell.delta then totals.delta = totals.delta + 1 end
                        if cell.braidedRiver then totals.braided = totals.braided + 1 end
                        if (cell.marineTerrace or 0) > 0 or (cell.fluvialTerrace or 0) > 0 then totals.terrace = totals.terrace + 1 end
                        if cell.playa then totals.playa = totals.playa + 1 end
                        if cell.sinkhole then totals.sinkhole = totals.sinkhole + 1 end
                    end
                end
            end
        end
    end
    print("smoke=terrain")
    print("chunks=" .. totals.chunks)
    print("land=" .. totals.land)
    print("water=" .. totals.water)
    print("rivers=" .. totals.river)
    print("talus=" .. totals.talus)
    print("alluvial_fans=" .. totals.alluvial)
    print("fan_lobes=" .. totals.fanLobe)
    print("floodplains=" .. totals.floodplain)
    print("deltas=" .. totals.delta)
    print("braided_rivers=" .. totals.braided)
    print("terraces=" .. totals.terrace)
    print("playas=" .. totals.playa)
    print("sinkholes=" .. totals.sinkhole)
    print("mesh_tiles=" .. renderStats.visibleTiles)
    print("triangles=" .. renderStats.triangles)
    print("river_strips=" .. renderStats.riverStrips)
    print("silhouettes=" .. renderStats.silhouetteStrips)
    print("billboards=" .. renderStats.billboards)
    print("landmarks=" .. renderStats.landmarks)
    print("camera_height=" .. string.format("%.3f", renderStats.cameraHeight))
    love.event.quit(0)
end

local function librarySmoke(args)
    love.graphics.setDefaultFilter("nearest", "nearest")
    local worldOptions = runtimeWorldOptions(args)
    local world = WorldGen.new(tonumber(argValue(args, "--seed", 20260625)), worldOptions)
    local smokeApp = {
        world = world,
        worldOptions = worldOptions,
        survey = Survey.new(),
        viewScale = ViewScale.new(world),
        player = Player.new(0, 0),
        camera = Render.defaultCamera(),
        pixelScale = 2,
        atmosphere = Atmosphere.new(),
    }
    local id = Save.writeWorld(nil, Save.snapshot(smokeApp), { name = "Smoke World" }, Thumbnail.png(world, { scale = world:metadata().scope }))
    local listed = false
    for _, item in ipairs(Save.listWorlds()) do
        if item.id == id then listed = true break end
    end
    Save.renameWorld(id, "Smoke Renamed")
    local renamed = Save.readWorld(id)
    local exportPath = Save.exportWorld(id)
    local exportBytes = exportPath and love.filesystem.read(exportPath)
    Save.deleteWorld(id)
    print("library-smoke=worlds")
    print("library-smoke-id=" .. tostring(id))
    print("library-smoke-listed=" .. tostring(listed))
    print("library-smoke-renamed=" .. tostring(renamed and renamed.meta and renamed.meta.name))
    print("library-smoke-export=" .. tostring(exportPath))
    print("library-smoke-export-zip=" .. tostring(exportBytes and string.sub(exportBytes, 1, 4) == "PK\003\004"))
    love.event.quit(0)
end

local function settingsSmoke()
    local original = Settings.load()
    local settings = Settings.load()
    local ok = Keybinds.rebind(settings, "forward", "z")
    Settings.save(settings)
    local reloaded = Settings.load()
    local duplicateOk, duplicate = Keybinds.rebind(reloaded, "back", "z")
    Settings.save(original)
    print("settings-smoke=settings")
    print("settings-smoke-rebind=" .. tostring(ok))
    print("settings-smoke-forward=" .. tostring(reloaded.controls.forward))
    print("settings-smoke-duplicate=" .. tostring(not duplicateOk and duplicate == "forward"))
    love.event.quit(0)
end

local function preloadApp(app, reason)
    local started = now()
    local view = ViewScale.params(app.viewScale, app.world)
    local viewRadius = frustumRadius(app)
    local configuredRadius = (reason == "load" or reason == "seed_reset") and app.preloadRadius or app.refreshPreloadRadius
    local terrainRadius = math.max(viewRadius * view.factor + terrainPreloadPadding, (configuredRadius or 0) * view.factor)
    local billboardRadius = math.max(viewRadius + billboardPreloadPadding, configuredRadius or 0)
    local terrainChunks = 0
    for _, scaleId in ipairs(ViewScale.preloadScales(app.viewScale)) do
        terrainChunks = terrainChunks + app.world:preloadAround(app.player.x, app.player.y, terrainRadius, scaleId)
    end
    local billboardChunks = view.factor <= 2.1 and app.world:preloadBillboardsAround(app.player.x, app.player.y, billboardRadius) or 0
    local size = app.world:metadata().chunkSize
    app.preloadedChunkX = math.floor(app.player.x / size)
    app.preloadedChunkY = math.floor(app.player.y / size)
    app.preloadedBandX = math.floor(app.player.x / preloadStride)
    app.preloadedBandY = math.floor(app.player.y / preloadStride)
    app.preloadedScale = view.target
    app.preloadedMinChunkX, app.preloadedMaxChunkX, app.preloadedMinChunkY, app.preloadedMaxChunkY = chunkRange(app, terrainRadius, view.target)
    local elapsed = msSince(started)
    if app.perf then app.perf.preloadMsThisFrame = (app.perf.preloadMsThisFrame or 0) + elapsed end
    perfLine(app, string.format(
        "preload reason=%s scale=%s factor=%.2f ms=%.2f terrain_chunks=%d billboard_chunks=%d terrain_radius=%.0f billboard_radius=%.0f chunk=%d,%d band=%d,%d",
        reason or "manual",
        view.target,
        view.factor,
        elapsed,
        terrainChunks,
        billboardChunks,
        terrainRadius,
        billboardRadius,
        app.preloadedChunkX,
        app.preloadedChunkY,
        app.preloadedBandX,
        app.preloadedBandY
    ))
end

local function setJournalOpen(app, open)
    app.journalOpen = open == true
    if app.journalOpen then
        app.mouseLook = false
        if love.mouse and love.mouse.setRelativeMode then love.mouse.setRelativeMode(false) end
    end
end

local function dropPin(app)
    local pin = Survey.dropPin(app.survey, app.world, app.player.x, app.player.y, ViewScale.activeScale(app.viewScale))
    app.minimapCache = nil
    print("[pin] dropped=" .. tostring(pin.id) .. " pins=" .. tostring(app.survey.pinCount or 0))
end

local function handleJournalAction(app, action)
    if not action then return end
    if action.type == "delete_pin" then
        if Survey.deletePin(app.survey, action.key) then
            app.minimapCache = nil
            print("[pin] deleted=" .. tostring(action.key) .. " pins=" .. tostring(app.survey.pinCount or 0))
        end
        return
    end
    if action.type == "teleport" and Journal.teleport(app, action.target, preloadApp) then
        setJournalOpen(app, false)
        print("[journal] teleport=" .. tostring(action.key) .. " pos=" .. string.format("%.2f,%.2f", app.player.x, app.player.y))
    end
end

local function adjustCameraZoom(app, wheelY)
    if not (app and app.camera) then return false end
    wheelY = tonumber(wheelY) or 0
    if wheelY == 0 then return false end
    local old = cameraZoom(app.camera)
    local nextZoom = Render.clampZoom(old * (1.15 ^ wheelY))
    app.camera.zoom = nextZoom
    if math.abs(nextZoom - old) <= 0.000001 then return false end
    if app.perf then app.perf.preloadMsThisFrame = 0 end
    preloadApp(app, "zoom")
    return true
end

local function refreshPreloadIfNeeded(app)
    local view = ViewScale.params(app.viewScale, app.world)
    local size = app.world:metadata().chunkSize
    local chunkX = math.floor(app.player.x / size)
    local chunkY = math.floor(app.player.y / size)
    local minChunkX, maxChunkX, minChunkY, maxChunkY = chunkRange(app, frustumRadius(app) * view.factor, view.target)
    if app.preloadedScale == view.target and app.preloadedMinChunkX and minChunkX >= app.preloadedMinChunkX and maxChunkX <= app.preloadedMaxChunkX and minChunkY >= app.preloadedMinChunkY and maxChunkY <= app.preloadedMaxChunkY then return end
    perfLine(app, string.format("preload_due scale=%s pos=%.2f,%.2f chunk=%d,%d visible_chunks=%d..%d,%d..%d loaded_chunks=%s..%s,%s..%s",
        view.target,
        app.player.x,
        app.player.y,
        chunkX,
        chunkY,
        minChunkX,
        maxChunkX,
        minChunkY,
        maxChunkY,
        tostring(app.preloadedMinChunkX),
        tostring(app.preloadedMaxChunkX),
        tostring(app.preloadedMinChunkY),
        tostring(app.preloadedMaxChunkY)
    ))
    preloadApp(app, "range")
end

local function perfSnapshot(app)
    local cache = app.world:cacheStats()
    local metrics = app.world:metricsSnapshot()
    local size = app.world:metadata().chunkSize
    local chunkX = math.floor(app.player.x / size)
    local chunkY = math.floor(app.player.y / size)
    local stats = app.perf.renderStats or {}
    local view = ViewScale.params(app.viewScale, app.world)
    local survey = app.survey or {}
    local line = string.format(
        "frame=%d fps=%d dt=%.2fms sim_dt=%.2fms update=%.2fms draw=%.2fms preload=%.2fms scale=%s factor=%.2f zoom=%.2f pos=%.2f,%.2f chunk=%d,%d band=%d,%d yaw=%.3f pitch=%.3f moving=%s sprint=%s bob=%.3f phase=%.2f mesh=%s tris=%s billboards=%s rivers=%s silhouettes=%s landmarks=%s cache=%d/%s chunks=%d hydro=%d basins=%d billboard_cache=%d hits=%d cmiss=%d evict=%d evict_kind=c%d/h%d/m%d/b%d async=q%d/d%d/f%d/p%d misses=c%d/h%d/m%d/b%d cells=h%d/m%d survey=%d:%d:%d",
        app.perf.frame or 0,
        love.timer.getFPS(),
        (app.perf.lastDt or 0) * 1000,
        (app.perf.simDt or 0) * 1000,
        app.perf.updateMs or 0,
        app.perf.drawMs or 0,
        app.perf.preloadMsThisFrame or 0,
        view.target,
        view.factor,
        cameraZoom(app.camera),
        app.player.x,
        app.player.y,
        chunkX,
        chunkY,
        math.floor(app.player.x / preloadStride),
        math.floor(app.player.y / preloadStride),
        app.camera.yaw or 0,
        app.camera.pitch or 0,
        flag(app.perf.moving),
        flag(app.perf.sprint),
        app.player.bobOffset or 0,
        app.player.footstepPhase or 0,
        tostring(stats.visibleTiles),
        tostring(stats.triangles),
        tostring(stats.billboards),
        tostring(stats.riverStrips),
        tostring(stats.silhouetteStrips),
        tostring(stats.landmarks),
        cache.total,
        tostring(cache.maxEntries),
        cache.chunks,
        cache.hydrology,
        cache.basins,
        cache.billboards,
        metrics.cacheHits,
        metrics.cacheMisses,
        metrics.cacheEvictions,
        metrics.evictions and metrics.evictions.chunks or 0,
        metrics.evictions and metrics.evictions.hydrology or 0,
        metrics.evictions and metrics.evictions.basins or 0,
        metrics.evictions and metrics.evictions.billboards or 0,
        metrics.asyncHydrology and metrics.asyncHydrology.queued or 0,
        metrics.asyncHydrology and metrics.asyncHydrology.completed or 0,
        metrics.asyncHydrology and metrics.asyncHydrology.failed or 0,
        metrics.asyncHydrology and metrics.asyncHydrology.pending or 0,
        metrics.chunkMisses,
        metrics.hydrologyMisses,
        metrics.basinMisses,
        metrics.billboardMisses,
        metrics.hydrologyCells,
        metrics.basinCells,
        survey.cellCount or 0,
        survey.discoveryCount or 0,
        survey.pinCount or 0
    )
    local weather = app.weatherState or {}
    return line .. string.format(
        " weather=%s precip=%s storm=%s vis=%.2f koppen=%s cue=%s",
        Weather.label(weather),
        tostring(weather.precipitation or "clear"),
        tostring(weather.storm or "none"),
        weather.visibility or 1,
        tostring(app.currentKoppen or weather.koppen or "??"),
        tostring(app.weatherAudioCue or weather.audioCue or "none")
    )
end

local function maybeLogPerf(app)
    if not app.debugPerf then return end
    local time = now()
    local interval = app.perf.interval or 1
    local slowMs = app.perf.slowFrameMs or 24
    local dtMs = (app.perf.lastDt or 0) * 1000
    local slow = dtMs > slowMs or (app.perf.updateMs or 0) > slowMs or (app.perf.drawMs or 0) > slowMs or (app.perf.preloadMsThisFrame or 0) > slowMs
    if slow or time - (app.perf.lastLogAt or 0) >= interval then
        app.perf.lastLogAt = time
        perfLine(app, (slow and "slow " or "tick ") .. perfSnapshot(app))
    end
end

local function applySnapshot(app, snapshot)
    local display = snapshot.display or {}
    if type(snapshot.world) == "table" then
        for key, value in pairs(snapshot.world) do
            if value ~= nil then app.worldOptions[key] = value end
        end
    end
    if (not snapshot.world or snapshot.world.scope == nil) and display.viewScale then app.worldOptions.scope = display.viewScale end
    replaceWorld(app, tonumber(snapshot.seed) or app.world:metadata().seed)
    local expectedHash = snapshot.world and snapshot.world.optionsHash
    local actualHash = Save.worldOptionsHash(app.world:metadata())
    app.worldOptionsHashMismatch = expectedHash and expectedHash ~= actualHash
    if app.worldOptionsHashMismatch then print("[save] world_hash_mismatch expected=" .. tostring(expectedHash) .. " actual=" .. tostring(actualHash)) end
    app.survey = Survey.fromSnapshot(snapshot.survey)
    app.journal = Journal.new()
    app.journalOpen = false
    app.saveSlotId = snapshot.meta and snapshot.meta.id or app.saveSlotId
    app.worldName = snapshot.meta and snapshot.meta.name or app.worldName
    app.player.x = snapshot.player and tonumber(snapshot.player.x) or 0
    app.player.y = snapshot.player and tonumber(snapshot.player.y) or 0
    app.camera = Render.defaultCamera()
    app.camera.yaw = snapshot.camera and tonumber(snapshot.camera.yaw) or app.camera.yaw
    app.camera.pitch = snapshot.camera and tonumber(snapshot.camera.pitch) or app.camera.pitch
    app.pixelScale = PostFX.parsePixelScale(display.pixelScale or app.pixelScale or 2)
    app.mouseLook = display.mouseLook == true
    app.debugPerf = display.debugPerf == true
    app.debugTopo = display.debugTopo == true
    app.minimap = display.minimap == true
    app.showWorldLabels = display.showWorldLabels ~= false
    app.showAreaLabels = display.showAreaLabels ~= false
    app.showPlayerHud = display.showPlayerHud ~= false
    if type(display.debugPanels) == "table" then
        app.debugPanels = {
            plate = display.debugPanels.plate == true,
            drainage = display.debugPanels.drainage == true,
            erosion = display.debugPanels.erosion == true,
            biome = display.debugPanels.biome == true,
        }
    else
        local on = display.debugPanels == true
        app.debugPanels = { plate = on, drainage = on, erosion = on, biome = on }
    end
    app.atmosphere = Atmosphere.new(snapshot.atmosphere or { time = display.atmosphereTime or 0.25, season = display.season or "summer" })
    app.atmosphereTime = app.atmosphere.time
    app.viewScale = ViewScale.new(app.world)
    ViewScale.update(app.viewScale, 1, app.world, app.player.x, app.player.y)
    updateWeather(app, 0)
    if love.mouse and love.mouse.setRelativeMode then love.mouse.setRelativeMode(app.mouseLook) end
    PostFX.resize(app, love.graphics.getDimensions())
    app.perf.preloadMsThisFrame = 0
    preloadApp(app, "save_load")
end

local function loadGame(args)
    if hasArg(args, "--export-map") then
        exportMap(args)
        return
    end
    if hasArg(args, "--smoke") then
        smoke(args)
        return
    end
    if hasArg(args, "--library-smoke") then
        librarySmoke(args)
        return
    end
    if hasArg(args, "--settings-smoke") then
        settingsSmoke()
        return
    end
    love.graphics.setDefaultFilter("nearest", "nearest")
    local worldOptions = runtimeWorldOptions(args)
    local settings = Settings.load()
    app = {
        mode = "play",
        world = WorldGen.new(tonumber(argValue(args, "--seed", 20260625)), worldOptions),
        worldOptions = worldOptions,
        settings = settings,
        asyncHydrology = not (hasArg(args, "--no-async") or hasArg(args, "--render-smoke")),
        survey = Survey.new(),
        journal = Journal.new(),
        journalOpen = false,
        viewScale = nil,
        player = Player.new(0, 0),
        camera = Render.defaultCamera(),
        pixelScale = PostFX.parsePixelScale(argValue(args, "--pixel-scale", settings.display.pixelScale or 2)),
        atmosphere = Atmosphere.new({
            time = tonumber(argValue(args, "--time-of-day", 0.25)) or 0.25,
            season = argValue(args, "--season", settings.display.startSeason or "summer"),
            dayLength = tonumber(argValue(args, "--day-length", settings.display.dayLength or 60)) or 60,
        }),
        weatherRuntime = Weather.new({
            bucket = tonumber(argValue(args, "--weather-bucket", nil)),
            clock = tonumber(argValue(args, "--weather-clock", 0)) or 0,
        }),
        paused = false,
        mouseLook = true,
        renderSmoke = hasArg(args, "--render-smoke"),
        walkSmoke = hasArg(args, "--walk-smoke"),
        debugTopo = hasArg(args, "--debug-topo") or settings.debug.topo == true,
        minimap = hasArg(args, "--minimap") or settings.debug.minimap == true or settings.display.showPlayerHud ~= false,
        showWorldLabels = settings.display.showWorldLabels ~= false,
        showAreaLabels = settings.display.showAreaLabels ~= false,
        showPlayerHud = settings.display.showPlayerHud ~= false,
        debugPanels = (function()
            local on = hasArg(args, "--debug-panels") or settings.debug.panels == true
            return { plate = on, drainage = on, erosion = on, biome = on }
        end)(),
        walkSmokeFrames = tonumber(argValue(args, "--walk-smoke-frames", 240)) or 240,
        walkSmokeTurn = tonumber(argValue(args, "--walk-smoke-turn", 0.18)) or 0.18,
        preloadRadius = tonumber(argValue(args, "--preload-radius", 64)) or 64,
        refreshPreloadRadius = tonumber(argValue(args, "--refresh-preload-radius", 72)) or 72,
        savePath = argValue(args, "--save-path", "thoth-save.json"),
        debugPerf = hasArg(args, "--debug-perf") or hasArg(args, "--log-fps") or hasArg(args, "--walk-smoke") or settings.debug.perf == true,
    }
    app.atmosphereTime = app.atmosphere.time
    PostFX.resize(app, love.graphics.getDimensions())
    app.viewScale = ViewScale.new(app.world)
    startAsyncHydrology(app)
    ViewScale.update(app.viewScale, 0, app.world, app.player.x, app.player.y)
    updateWeather(app, 0)
    app.perf = {
        frame = 0,
        interval = tonumber(argValue(args, "--perf-interval", 1)) or 1,
        slowFrameMs = tonumber(argValue(args, "--slow-frame-ms", 24)) or 24,
        lastLogAt = now(),
    }
    perfLine(app, string.format("load seed=%s scale=%s render_radius=%d zoom=%.2f preload_radius=%d refresh_radius=%d preload_stride=%d hydrology_regions=%d hydrology_halo=%d basin_chunks=%d basin_stride=%d slow_ms=%.1f interval=%.2f",
        tostring(app.world:metadata().seed),
        ViewScale.activeScale(app.viewScale),
        app.camera.renderRadius or 0,
        cameraZoom(app.camera),
        app.preloadRadius,
        app.refreshPreloadRadius,
        preloadStride,
        app.world:metadata().hydrologyRegionChunks or 0,
        app.world:metadata().hydrologyHaloCells or 0,
        app.world:metadata().hydrologyBasinChunks or 0,
        app.world:metadata().hydrologyBasinStride or 0,
        app.perf.slowFrameMs,
        app.perf.interval
    ))
    local loadPath = argValue(args, "--load-save", nil)
    if loadPath then applySnapshot(app, Save.read(loadPath)) end
    preloadApp(app, "load")
    if hasArg(args, "--zoom-smoke") then
        local before = cameraZoom(app.camera)
        local changedUp = adjustCameraZoom(app, 1)
        local up = cameraZoom(app.camera)
        adjustCameraZoom(app, 100)
        local maxZoom = cameraZoom(app.camera)
        local maxNoop = not adjustCameraZoom(app, 1)
        adjustCameraZoom(app, -100)
        local minZoom = cameraZoom(app.camera)
        local minNoop = not adjustCameraZoom(app, -1)
        print("zoom-smoke=zoom")
        print("zoom-smoke-before=" .. string.format("%.2f", before))
        print("zoom-smoke-up=" .. tostring(changedUp) .. ":" .. string.format("%.2f", up))
        print("zoom-smoke-max=" .. string.format("%.2f", maxZoom) .. ":" .. tostring(maxNoop))
        print("zoom-smoke-min=" .. string.format("%.2f", minZoom) .. ":" .. tostring(minNoop))
        love.event.quit(0)
    end
    if love.mouse and love.mouse.setRelativeMode then love.mouse.setRelativeMode(app.mouseLook) end
    return app
end

local function menuArgs(args)
    return {
        seed = argValue(args, "--seed", ""),
        randomSeed = os.time() % 100000000,
    }
end

local function startMenu(args)
    love.graphics.setDefaultFilter("nearest", "nearest")
    app = {
        mode = "menu",
        args = args or {},
        menu = Menu.new(menuArgs(args or {})),
        menuSmoke = hasArg(args or {}, "--menu-smoke"),
        menuSmokeFrames = tonumber(argValue(args or {}, "--menu-smoke-frames", 1)) or 1,
        menuSmokeFrame = 0,
    }
    local smokeState = argValue(args or {}, "--menu-smoke-state", nil)
    if smokeState then app.menu.state = smokeState end
    if love.mouse and love.mouse.setRelativeMode then love.mouse.setRelativeMode(false) end
end

local function startGame(args)
    loadGame(Game.addArg(args or {}, "--skip-menu"))
end

local function thumbnailFor(app)
    return Thumbnail.png(app.world, { scale = ViewScale.activeScale(app.viewScale), x = app.player.x, y = app.player.y })
end

local function handleMenuAction(action)
    if type(action) == "table" and action.kind == "play-create" then
        startGame(action.args or {})
        app.worldName = action.name or "New World"
        app.saveSlotId = Save.writeWorld(nil, Save.snapshot(app), { name = app.worldName }, thumbnailFor(app))
    elseif type(action) == "table" and action.kind == "play-world" then
        local snapshot = Save.readWorld(action.id)
        if snapshot then
            startGame({})
            applySnapshot(app, snapshot)
            app.saveSlotId = action.id
            app.worldName = snapshot.meta and snapshot.meta.name or app.worldName
        end
    elseif action == "quit" then
        love.event.quit(0)
    elseif action == "play-default" then
        startGame(app and app.args or {})
    end
end

function love.load(args)
    if Game.startsInPlay(args) then
        loadGame(args)
    else
        startMenu(args)
    end
end

function love.update(dt)
    if not app then return end
    if app.mode == "menu" then
        handleMenuAction(Menu.update(app.menu, dt))
        return
    end
    local started = now()
    app.perf.preloadMsThisFrame = 0
    if app.world.pollAsyncHydrology then app.world:pollAsyncHydrology(16) end
    app.perf.lastDt = dt
    local simDt = math.min(dt, maxSimDt)
    app.perf.simDt = simDt
    if not app.paused then
        Atmosphere.update(app.atmosphere, simDt)
        app.atmosphereTime = app.atmosphere.time
    end
    local turn = (Keybinds.isDown(app.settings, "lookRight") and 1 or 0) - (Keybinds.isDown(app.settings, "lookLeft") and 1 or 0)
    local pitch = (Keybinds.isDown(app.settings, "pitchDown") and 1 or 0) - (Keybinds.isDown(app.settings, "pitchUp") and 1 or 0)
    if app.walkSmoke then turn = app.walkSmokeTurn end
    if app.journalOpen then turn, pitch = 0, 0 end
    app.camera.yaw = app.camera.yaw + turn * simDt * 1.9
    app.camera.pitch = math.max(-0.42, math.min(0.38, app.camera.pitch + pitch * simDt * 0.85))
    local inputBlocked = app.journalOpen == true
    local input = {
        forward = app.walkSmoke or (not inputBlocked and Keybinds.isDown(app.settings, "forward")),
        back = not inputBlocked and Keybinds.isDown(app.settings, "back"),
        left = not inputBlocked and Keybinds.isDown(app.settings, "left"),
        right = not inputBlocked and Keybinds.isDown(app.settings, "right"),
        sprint = app.walkSmoke and true or (not inputBlocked and Keybinds.isDown(app.settings, "sprint")),
        yaw = app.camera.yaw,
        scope = ViewScale.activeScale(app.viewScale),
        headBob = app.settings.display.headBob,
        cameraSway = app.settings.display.cameraSway,
    }
    app.perf.moving = input.forward or input.back or input.left or input.right
    app.perf.sprint = input.sprint
    Player.update(app.player, simDt, input, app.world)
    app.camera.eyeHeight = app.player.eyeHeight or app.camera.eyeHeight
    app.camera.swayAngle = app.player.swayAngle or 0
    ViewScale.update(app.viewScale, simDt, app.world, app.player.x, app.player.y)
    updateWeather(app, app.paused and 0 or simDt)
    updateBiomeBanner(app, simDt)
    refreshPreloadIfNeeded(app)
    app.camera.x = app.camera.x + (app.player.x - app.camera.x) * math.min(1, simDt * 10)
    app.camera.y = app.camera.y + (app.player.y - app.camera.y) * math.min(1, simDt * 10)
    app.perf.updateMs = msSince(started)
end

function love.draw()
    if not app then return end
    if app.mode == "menu" then
        Menu.draw(app.menu)
        if app.menuSmoke and not app.menuSmokePrinted then
            app.menuSmokeFrame = (app.menuSmokeFrame or 0) + 1
            if app.menuSmokeFrame < (app.menuSmokeFrames or 1) then return end
            app.menuSmokePrinted = true
            print("menu-smoke=" .. tostring(app.menu.state))
            print("menu-smoke-seed=" .. tostring(app.menu.backdropMetadata and app.menu.backdropMetadata.seed))
            if app.menu.state == "create" then
                print("menu-smoke-create-scope=" .. tostring(app.menu.create and app.menu.create.scope))
                print("menu-smoke-create-preview=" .. tostring(app.menu.create and app.menu.create.preview ~= nil))
            end
            love.event.quit(0)
        end
        return
    end
    local started = now()
    local stats = PostFX.draw(app, function(width, height)
        return Render.drawScene(app, width, height)
    end, function(width, height, meshData)
        return Render.drawHud(app, width, height, meshData)
    end)
    app.perf.drawMs = msSince(started)
    app.perf.renderStats = stats
    if app.journalOpen then
        handleJournalAction(app, Journal.draw(app.journal, app, love.graphics.getDimensions()))
    end
    app.perf.frame = (app.perf.frame or 0) + 1
    maybeLogPerf(app)
    if app.renderSmoke and not app.renderSmokePrinted then
        app.renderSmokePrinted = true
        print("render-smoke=terrain3d")
        print("render-smoke-tiles=" .. tostring(stats.visibleTiles))
        print("render-smoke-triangles=" .. tostring(stats.triangles))
        print("render-smoke-river-strips=" .. tostring(stats.riverStrips))
        print("render-smoke-silhouettes=" .. tostring(stats.silhouetteStrips))
        print("render-smoke-billboards=" .. tostring(stats.billboards))
        print("render-smoke-landmarks=" .. tostring(stats.landmarks))
        print("render-smoke-zoom=" .. string.format("%.2f", stats.zoom or 1))
        print("render-smoke-sway=" .. tostring(stats.swayBillboards or 0) .. ":" .. string.format("%.3f", stats.swayTime or 0))
        print("world-labels=" .. tostring(stats.worldLabels or 0))
        print("render-smoke-pixel-scale=" .. tostring(stats.pixelScale))
        print("render-smoke-lowres=" .. tostring(stats.lowResCanvasWidth) .. "x" .. tostring(stats.lowResCanvasHeight))
        print("render-smoke-palette=" .. tostring(stats.paletteId) .. ":" .. tostring(stats.paletteSize))
        print("render-smoke-sky=" .. tostring(stats.skyDome) .. ":" .. string.format("%.3f", stats.skyTime or 0) .. ":" .. tostring(stats.skySeason))
        print("render-smoke-weather=" .. tostring(stats.weather) .. ":" .. tostring(stats.weatherStorm) .. ":" .. string.format("%.2f", stats.weatherVisibility or 1) .. ":" .. tostring(stats.weatherParticles or 0))
        if stats.clipmap then
            print("render-smoke-clipmap=" .. tostring(stats.clipmapRings or 0) .. ":" .. tostring(stats.clipmapRadius or 0) .. ":" .. tostring(stats.clipmapSteps or "") .. ":" .. tostring(stats.clipmapSamplesRefilled or 0))
        end
        love.event.quit(0)
    end
    if app.walkSmoke and app.perf.frame >= app.walkSmokeFrames then
        print("walk-smoke=terrain3d")
        print("walk-smoke-frames=" .. tostring(app.perf.frame))
        print("walk-smoke-pos=" .. string.format("%.2f,%.2f", app.player.x, app.player.y))
        print("walk-smoke-final=" .. perfSnapshot(app))
        love.event.quit(0)
    end
end

function love.resize(width, height)
    if app and app.mode == "play" then PostFX.resize(app, width, height) end
end

function love.keypressed(key)
    if not app then return end
    if app.mode == "menu" then
        handleMenuAction(Menu.keypressed(app.menu, key))
        return
    end
    local action = Keybinds.actionForKey(app.settings, key)
    if action == "quit" or action == "quitAlt" then
        exitApp(app)
        return
    end
    if app.walkSmoke then return end
    if action == "toggleJournal" then
        setJournalOpen(app, not app.journalOpen)
        print("[journal] open=" .. tostring(app.journalOpen))
        return
    end
    if action == "dropPin" then
        dropPin(app)
        return
    end
    if action == "togglePlayerHud" then
        app.showPlayerHud = not app.showPlayerHud
        print("[hud] player=" .. tostring(app.showPlayerHud))
        return
    end
    if app.journalOpen then return end
    if action == "toggleMouseLook" then
        app.mouseLook = not app.mouseLook
        if love.mouse and love.mouse.setRelativeMode then love.mouse.setRelativeMode(app.mouseLook) end
    end
    if action == "togglePerf" then
        app.debugPerf = not app.debugPerf
        print("[perf] debug=" .. tostring(app.debugPerf))
    end
    if action == "toggleTopo" then
        app.debugTopo = not app.debugTopo
        print("[topo] debug=" .. tostring(app.debugTopo))
    end
    if action == "toggleMinimap" then
        app.minimap = not app.minimap
        print("[minimap] visible=" .. tostring(app.minimap))
    end
    if action == "togglePanels" then
        if type(app.debugPanels) ~= "table" then
            app.debugPanels = { plate = false, drainage = false, erosion = false, biome = false }
        end
        local anyOn = false
        for _, value in pairs(app.debugPanels) do if value then anyOn = true break end end
        local nextValue = not anyOn
        app.debugPanels.plate = nextValue
        app.debugPanels.drainage = nextValue
        app.debugPanels.erosion = nextValue
        app.debugPanels.biome = nextValue
        print("[panels] all=" .. tostring(nextValue))
    end
    do
        local panelByAction = { panelPlate = "plate", panelDrainage = "drainage", panelErosion = "erosion", panelBiome = "biome" }
        local id = panelByAction[action]
        if id then
            if type(app.debugPanels) ~= "table" then
                app.debugPanels = { plate = false, drainage = false, erosion = false, biome = false }
            end
            app.debugPanels[id] = not app.debugPanels[id]
            print("[panel] " .. id .. "=" .. tostring(app.debugPanels[id]))
        end
        if action == "toggleTopoAlt" then
            app.debugTopo = not app.debugTopo
            print("[topo] debug=" .. tostring(app.debugTopo))
        end
    end
    if action == "seasonPrev" or action == "seasonNext" then
        local season = Atmosphere.shiftSeason(app.atmosphere, action == "seasonNext" and 1 or -1)
        print("[season] " .. tostring(season))
    end
    if action == "save" then
        if app.saveSlotId then
            Save.writeWorld(app.saveSlotId, Save.snapshot(app), { name = app.worldName or "World" }, thumbnailFor(app))
            print("[save] wrote_slot=" .. tostring(app.saveSlotId))
        else
            Save.write(app.savePath, Save.snapshot(app))
            print("[save] wrote=" .. tostring(app.savePath))
        end
    end
    if action == "load" then
        local ok, snapshot = pcall(function()
            if app.saveSlotId then return Save.readWorld(app.saveSlotId) end
            return Save.read(app.savePath)
        end)
        if ok then
            applySnapshot(app, snapshot)
            print("[save] loaded=" .. tostring(app.saveSlotId or app.savePath))
        else
            print("[save] load_failed=" .. tostring(snapshot))
        end
    end
    if action == "markSurvey" then
        Survey.mark(app.survey, app.world, app.player.x, app.player.y, ViewScale.activeScale(app.viewScale))
        print("[survey] cells=" .. tostring(app.survey.cellCount) .. " discoveries=" .. tostring(app.survey.discoveryCount))
    end
    if action == "newSeed" then
        replaceWorld(app, os.time() % 1000000)
        app.survey = Survey.new()
        app.journal = Journal.new()
        app.journalOpen = false
        app.viewScale = ViewScale.new(app.world)
        app.player.x, app.player.y = 0, 0
        app.perf.preloadMsThisFrame = 0
        preloadApp(app, "seed_reset")
    end
end

function love.quit()
    if app and app.world and app.world.shutdownAsyncHydrology then app.world:shutdownAsyncHydrology(false) end
end

function love.mousemoved(_, _, dx, dy)
    if not app or app.mode ~= "play" or not app.mouseLook or app.walkSmoke then return end
    app.camera.yaw = app.camera.yaw + dx * (app.settings.display.mouseSensitivityX or 0.0025)
    app.camera.pitch = math.max(-0.42, math.min(0.38, app.camera.pitch - dy * (app.settings.display.mouseSensitivityY or 0.0018)))
end

function love.mousepressed(x, y, button)
    if app and app.mode == "menu" then Menu.mousepressed(app.menu, x, y, button) end
    if app and app.mode == "play" and app.journalOpen then Journal.mousepressed(app.journal, x, y, button) end
end

function love.mousereleased(x, y, button)
    if app and app.mode == "menu" then Menu.mousereleased(app.menu, x, y, button) end
    if app and app.mode == "play" and app.journalOpen then Journal.mousereleased(app.journal, x, y, button) end
end

function love.textinput(text)
    if app and app.mode == "menu" then Menu.textinput(app.menu, text) end
end

function love.wheelmoved(x, y)
    if not app then return end
    if app.mode == "menu" then
        Menu.wheelmoved(app.menu, x, y)
        return
    end
    if app.mode == "play" and app.journalOpen then
        Journal.wheelmoved(app.journal, x, y)
        return
    end
    if app.mode == "play" then adjustCameraZoom(app, y) end
end
