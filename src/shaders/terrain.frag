extern vec3 fogColor;
extern number fogNear;
extern number fogFar;
extern number fogAmount;
extern number lightAmount;

vec4 effect(vec4 color, Image texture, vec2 textureCoords, vec2 screenCoords)
{
    number light = mix(1.0, textureCoords.x, lightAmount);
    number fogSpan = max(1.0, fogFar - fogNear);
    number fog = clamp((textureCoords.y - fogNear) / fogSpan, 0.0, 1.0) * fogAmount;
    vec3 shaded = clamp(color.rgb * light, vec3(0.0), vec3(1.0));
    return vec4(mix(shaded, fogColor, fog), color.a);
}
