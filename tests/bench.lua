package.path = "./?.lua;./?/init.lua;./src/?.lua;./src/?/init.lua;" .. package.path

local Benchmark = require("src.benchmark")

local function cliValue(args, flag, fallback)
    for index, item in ipairs(args or {}) do
        if item == flag then return args[index + 1] or fallback end
    end
    return fallback
end

local function csvList(value)
    if not value then return nil end
    local out = {}
    for item in string.gmatch(value, "([^,]+)") do out[#out + 1] = item end
    return out
end

local result = Benchmark.run({
    seed = tonumber(cliValue(arg, "--seed", 20260625)) or 20260625,
    chunkRadius = tonumber(cliValue(arg, "--chunk-radius", 1)) or 1,
    scales = csvList(cliValue(arg, "--scales")),
    worldOptions = { hydrologyRegionChunks = 1, hydrologyHaloCells = 0, hydrologyBasinChunks = 8, hydrologyBasinStride = 8, hydrologyBasinFlowScale = 0.6 },
})
print(Benchmark.format(result))

local updatePath = cliValue(arg, "--update-baseline")
if updatePath then
    Benchmark.writeBaseline(updatePath, Benchmark.snapshot(result))
    print("benchmark-baseline-written=" .. updatePath)
    return
end

local baselinePath = cliValue(arg, "--baseline")
if baselinePath then
    local baseline = Benchmark.readBaseline(baselinePath)
    if not baseline then
        print("benchmark-baseline-missing=" .. baselinePath)
        return
    end
    local tolerance = tonumber(cliValue(arg, "--baseline-tolerance", 0.1)) or 0.1
    local check = Benchmark.compareToBaseline(result, baseline, tolerance)
    print(string.format(
        "benchmark-baseline=%s baseline_cells_per_sec=%.0f current_cells_per_sec=%.0f ratio=%.3f tolerance=%.2f status=%s",
        baselinePath,
        check.baseline or 0,
        check.current or 0,
        check.ratio or 0,
        tolerance,
        check.ok and "ok" or "regression"
    ))
    if not check.ok then
        error(string.format(
            "benchmark regression: %.0f cells/sec is below %.0f floor (baseline %.0f, tolerance %.0f%%)",
            check.current,
            check.floor,
            check.baseline,
            tolerance * 100
        ), 0)
    end
end
