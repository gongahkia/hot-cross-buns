local Lru = {}
Lru.__index = Lru

function Lru.new(limit)
    return setmetatable({ limit = limit, map = {}, count = 0 }, Lru)
end

function Lru:unlink(node)
    if node.prev then node.prev.next = node.next else self.head = node.next end
    if node.next then node.next.prev = node.prev else self.tail = node.prev end
    node.prev, node.next = nil, nil
end

function Lru:pushFront(node)
    node.next = self.head
    if self.head then self.head.prev = node else self.tail = node end
    self.head = node
end

function Lru:get(key)
    local node = self.map[key]
    if not node then return nil end
    self:unlink(node)
    self:pushFront(node)
    return node.value
end

function Lru:delete(key)
    local node = self.map[key]
    if not node then return nil end
    self.map[key] = nil
    self:unlink(node)
    self.count = self.count - 1
    return node.value
end

function Lru:set(key, value)
    local node = self.map[key]
    if node then
        node.value = value
        self:unlink(node)
        self:pushFront(node)
        return nil
    end
    node = { key = key, value = value }
    self.map[key] = node
    self:pushFront(node)
    self.count = self.count + 1
    if self.limit and self.count > self.limit then
        local evicted = self.tail
        self:delete(evicted.key)
        return evicted.key, evicted.value
    end
    return nil
end

return Lru
