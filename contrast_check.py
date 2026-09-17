from math import pow

def luminance(rgb):
    def channel(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else pow((c + 0.055) / 1.055, 2.4)
    r, g, b = rgb
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)

def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    return (la + 0.05) / (lb + 0.05) if la > lb else (lb + 0.05) / (la + 0.05)

pairs = [
    ('hero h1', '#1f4f3d', '#ffffff'),
    ('hero p', '#3c6f56', '#ffffff'),
    ('navbar-brand', '#264d3d', 'rgba(255,255,255,0.96)'),
    ('nav-link', '#32654f', 'rgba(255,255,255,0.96)'),
    ('nav-link active', '#1e492f', 'rgba(255,255,255,0.96)'),
    ('card text', '#224d3f', 'rgba(255,255,255,0.96)'),
    ('subtle/help', '#436f5d', 'rgba(255,255,255,0.96)'),
    ('input text', '#264d3d', 'rgba(255,255,255,0.98)'),
    ('placeholder', '#6e8a7a', 'rgba(255,255,255,0.98)'),
    ('secondary-btn', '#235342', 'rgba(245,250,244,0.95)'),
]

for name, fg, bg in pairs:
    if bg.startswith('rgba'):
        nums = [float(x) for x in bg[5:-1].split(',')]
        alpha = nums[3]
        rgb = tuple(nums[:3])
        bg_rgb = tuple(int((1 - alpha) * 255 + alpha * c) for c in rgb)
    else:
        bg_rgb = hex_to_rgb(bg)
    print(f'{name}: {contrast(hex_to_rgb(fg), bg_rgb):.2f}')
