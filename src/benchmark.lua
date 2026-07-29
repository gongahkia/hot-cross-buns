local WorldGen = require("src.worldgen")
local Save = require("src.save")

local Benchmark = {}

local function copyList(input)
    local out = {}
    for index, value in ipairs(input or {}) do out[index] = value end
    return out
end

local function scaleIds(world, selected)
    if selected and #selected > 0 then return copyList(selected) end
    local ids = {}
    for _, scale in ipairs(world:metadata().scales) do ids[#ids + 1] = scale.id end
    return ids
end

function Benchmark.run(options)
    options = options or {}
    local world = WorldGen.new(options.seed or 20260625, options.worldOptions)
    local chunkRadius = options.chunkRadius or 1
    local scales = scaleIds(world, options.scales)
    local started = os.clock()
    local chunks = 0
    local cells = 0
    for _, scale in ipairs(scales) do
        for cy = -chunkRadius, chunkRadius do
            for cx = -chunkRadius, chunkRadius do
                local chunk = world:chunk(cx, cy, scale)
                chunks = chunks + 1
                cells = cells + chunk.size * chunk.size
            end
        end
    end
    local seconds = math.max(0.000001, os.clock() - started)
    return {
        seed = world:metadata().seed,
        chunkRadius = chunkRadius,
        scales = scales,
        chunks = chunks,
        cells = cells,
        seconds = seconds,
        chunksPerSecond = chunks / seconds,
        cellsPerSecond = cells / seconds,
        cache = world:cacheStats(),
        metrics = world:metricsSnapshot(),
    }
end

function Benchmark.format(result)
    return string.format(
        "benchmark=terrain seed=%s radius=%d scales=%s chunks=%d cells=%d seconds=%.3f chunks_per_sec=%.2f cells_per_sec=%.0f cache=%d/%s evictions=%d misses=c%d/h%d/m%d/b%d",
        tostring(result.seed),
        result.chunkRadius,
        table.concat(result.scales, ","),
        result.chunks,
        result.cells,
        result.seconds,
        result.chunksPerSecond,
        result.cellsPerSecond,
        result.cache.total,
        tostring(result.cache.maxEntries),
        result.cache.evictions or 0,
        result.metrics.chunkMisses,
        result.metrics.hydrologyMisses,
        result.metrics.basinMisses,
        result.metrics.billboardMisses
    )
end

function Benchmark.snapshot(result)
    return {
        seed = tonumber(result.seed) or result.seed,
        chunkRadius = result.chunkRadius,
        scales = copyList(result.scales),
        chunks = result.chunks,
        cells = result.cells,
        cellsPerSecond = result.cellsPerSecond,
        chunksPerSecond = result.chunksPerSecond,
    }
end

function Benchmark.readBaseline(path)
    local handle = io.open(path, "r")
    if not handle then return nil end
    local text = handle:read("*a")
    handle:close()
    if not text or text == "" then return nil end
    return Save.decode(text)
end

function Benchmark.writeBaseline(path, snapshot)
    local handle = assert(io.open(path, "w"))
    handle:write(Save.encode(snapshot))
    handle:write("\n")
    handle:close()
end

function Benchmark.compareToBaseline(result, baseline, tolerance)
    tolerance = tolerance or 0.1
    if not baseline or not baseline.cellsPerSecond then return { ok = true, reason = "no baseline" } end
    local floor = baseline.cellsPerSecond * (1 - tolerance)
    if result.cellsPerSecond >= floor then
        return {
            ok = true,
            baseline = baseline.cellsPerSecond,
            current = result.cellsPerSecond,
            ratio = result.cellsPerSecond / baseline.cellsPerSecond,
        }
    end
    return {
        ok = false,
        baseline = baseline.cellsPerSecond,
        current = result.cellsPerSecond,
        ratio = result.cellsPerSecond / baseline.cellsPerSecond,
        floor = floor,
    }
end

return Benchmark
