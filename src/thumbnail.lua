local Export = require("src.export")

local Thumbnail = {}

function Thumbnail.png(world, options)
    options = options or {}
    local map = Export.renderMap(world, {
        size = options.size or 128,
        span = options.span or 768,
        scale = options.scale or (world:metadata().scope or "local"),
        x = options.x or 0,
        y = options.y or 0,
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
    return imageData:encode("png")
end

return Thumbnail
