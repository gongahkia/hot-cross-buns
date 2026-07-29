local Game = {}

function Game.hasArg(args, value)
    for _, arg in ipairs(args or {}) do
        if arg == value then return true end
    end
    return false
end

function Game.argValue(args, flag, fallback)
    for index, arg in ipairs(args or {}) do
        if arg == flag then return args[index + 1] or fallback end
    end
    return fallback
end

function Game.startsInPlay(args)
    return Game.hasArg(args, "--skip-menu")
        or Game.hasArg(args, "--load-save")
        or Game.hasArg(args, "--render-smoke")
        or Game.hasArg(args, "--walk-smoke")
        or Game.hasArg(args, "--library-smoke")
        or Game.hasArg(args, "--settings-smoke")
        or Game.hasArg(args, "--export-map")
        or Game.hasArg(args, "--smoke")
end

function Game.addArg(args, value)
    local nextArgs = {}
    for index, arg in ipairs(args or {}) do nextArgs[index] = arg end
    if not Game.hasArg(nextArgs, value) then nextArgs[#nextArgs + 1] = value end
    return nextArgs
end

return Game
