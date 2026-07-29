local Player = {}

local tau = math.pi * 2
local walkSpeed = 28
local sprintMultiplier = 1.75
local maxStepUp = 0.5
local stumbleStep = 0.25
local wadeMax = 0.3

local function clamp(value, minValue, maxValue)
    return math.max(minValue, math.min(maxValue, value))
end

local function defaultCell()
    return { elevation = 0, biome = "ground", slope = 0, water = false }
end

local function sample(world, x, y, scope)
    if not (world and world.sample) then return defaultCell() end
    return world:sample(math.floor(x), math.floor(y), scope or "local") or defaultCell()
end

local function scopeFor(input, world)
    if input and input.scope then return input.scope end
    local metadata = world and world.metadata and world:metadata() or nil
    return (metadata and metadata.scope) or "local"
end

local function waterDepth(cell)
    if not (cell and cell.water) then return 0 end
    if type(cell.lakeDepth) == "number" and cell.lakeDepth > 0 then return cell.lakeDepth end
    if type(cell.waterDepth) == "number" and cell.waterDepth > 0 then return cell.waterDepth end
    return 1
end

local function inputVector(input)
    local dx, dy
    if input and input.yaw then
        local forward = (input.forward and 1 or 0) - (input.back and 1 or 0)
        local strafe = (input.right and 1 or 0) - (input.left and 1 or 0)
        local forwardX, forwardY = math.sin(input.yaw), -math.cos(input.yaw)
        local rightX, rightY = math.cos(input.yaw), math.sin(input.yaw)
        dx = forwardX * forward + rightX * strafe
        dy = forwardY * forward + rightY * strafe
    else
        dx = ((input and input.right) and 1 or 0) - ((input and input.left) and 1 or 0)
        dy = ((input and input.down) and 1 or 0) - ((input and input.up) and 1 or 0)
    end
    if dx == 0 and dy == 0 then return 0, 0, false end
    local length = math.sqrt(dx * dx + dy * dy)
    return dx / length, dy / length, true
end

local function canEnter(player, world, scope, x, y)
    local current = sample(world, player.x, player.y, scope)
    local target = sample(world, x, y, scope)
    local delta = (target.elevation or 0) - (current.elevation or 0)
    if delta > maxStepUp then return false, target, delta end
    if waterDepth(target) > wadeMax then return false, target, delta end
    return true, target, delta
end

local function movePlayer(player, world, scope, dx, dy)
    local distance = math.sqrt(dx * dx + dy * dy)
    if distance <= 0.000001 then return true, true end
    local steps = math.max(1, math.ceil(distance / 0.45))
    local stepX, stepY = dx / steps, dy / steps
    local movedX = math.abs(stepX) <= 0.000001
    local movedY = math.abs(stepY) <= 0.000001
    for _ = 1, steps do
        local ok, _, delta = canEnter(player, world, scope, player.x + stepX, player.y + stepY)
        if ok then
            player.x = player.x + stepX
            player.y = player.y + stepY
            movedX = movedX or math.abs(stepX) > 0
            movedY = movedY or math.abs(stepY) > 0
            if delta >= stumbleStep then player.stumbleCooldown = 0.4 end
        else
            local okX, _, deltaX = canEnter(player, world, scope, player.x + stepX, player.y)
            if okX then
                player.x = player.x + stepX
                movedX = true
                if deltaX >= stumbleStep then player.stumbleCooldown = 0.4 end
            end
            local okY, _, deltaY = canEnter(player, world, scope, player.x, player.y + stepY)
            if okY then
                player.y = player.y + stepY
                movedY = true
                if deltaY >= stumbleStep then player.stumbleCooldown = 0.4 end
            end
        end
    end
    return movedX, movedY
end

local function emitFootstep(player, cell)
    local surface = (cell and cell.water and "water") or (cell and cell.biome) or "ground"
    player.footsteps = (player.footsteps or 0) + 1
    player.lastFootstepSurface = surface
    if player.onFootstep then player.onFootstep(cell, surface) end
end

local function strideShape(phase)
    local stride = (phase % tau) / tau
    local rise = stride < 0.5 and stride * 2 or (1 - stride) * 2
    return rise * rise * (3 - 2 * rise)
end

local function updateStride(player, dt, input, cell)
    local speed = math.sqrt((player.vx or 0) * (player.vx or 0) + (player.vy or 0) * (player.vy or 0))
    if speed <= 0.5 then
        player.bobOffset = 0
        player.swayAngle = 0
        return
    end
    local sprinting = input and input.sprint
    local hz = sprinting and 3.4 or 2.1
    local ratio = clamp(speed / walkSpeed, 0, sprintMultiplier)
    local oldTotal = player.footstepTotal or 0
    local newTotal = oldTotal + tau * hz * ratio * (dt or 0)
    for _ = math.floor(oldTotal / math.pi) + 1, math.floor(newTotal / math.pi) do
        emitFootstep(player, cell)
    end
    player.footstepTotal = newTotal
    player.footstepPhase = newTotal % tau
    local shape = strideShape(player.footstepPhase)
    if input and input.headBob then
        local amplitude = (sprinting and 0.14 or 0.08) * clamp(ratio, 0, 1.25)
        player.bobOffset = -amplitude * shape
    else
        player.bobOffset = 0
    end
    if input and input.cameraSway then
        local side = player.footstepPhase < math.pi and -1 or 1
        player.swayAngle = side * math.rad(0.5) * shape * clamp(ratio, 0, 1)
    else
        player.swayAngle = 0
    end
end

function Player.new(x, y)
    return {
        x = x or 0,
        y = y or 0,
        vx = 0,
        vy = 0,
        speed = walkSpeed,
        travelX = 0,
        travelY = -1,
        eyeHeight = 1.7,
        elevation = 0,
        waterDepth = 0,
        footstepPhase = 0,
        footstepTotal = 0,
        bobOffset = 0,
        swayAngle = 0,
        stumbleCooldown = 0,
        footsteps = 0,
        lastFootstepSurface = nil,
    }
end

function Player.update(player, dt, input, world)
    dt = dt or 0
    local scope = scopeFor(input, world)
    local cell = sample(world, player.x, player.y, scope)
    local dx, dy, moving = inputVector(input or {})
    if moving then
        player.travelX = dx
        player.travelY = dy
    end
    local depth = waterDepth(cell)
    local terrainSlow = depth > 0 and 0.15 or ((cell.slope or 0) > 0.12 and 0.7 or 1)
    local stumbling = (player.stumbleCooldown or 0) > 0
    local targetSpeed = moving and (player.speed or walkSpeed) * terrainSlow * ((input and input.sprint) and sprintMultiplier or 1) or 0
    if stumbling then targetSpeed = targetSpeed * 0.5 end
    local accel = moving and ((depth > 0 and 3) or ((input and input.sprint) and 5 or 8)) or 12
    local blend = 1 - math.exp(-accel * dt)
    player.vx = (player.vx or 0) + (dx * targetSpeed - (player.vx or 0)) * blend
    player.vy = (player.vy or 0) + (dy * targetSpeed - (player.vy or 0)) * blend
    local movedX, movedY = movePlayer(player, world, scope, player.vx * dt, player.vy * dt)
    if not movedX then player.vx = 0 end
    if not movedY then player.vy = 0 end
    cell = sample(world, player.x, player.y, scope)
    player.elevation = cell.elevation or 0
    player.waterDepth = waterDepth(cell)
    player.stumbleCooldown = math.max(0, (player.stumbleCooldown or 0) - dt)
    updateStride(player, dt, input or {}, cell)
    return player
end

return Player
