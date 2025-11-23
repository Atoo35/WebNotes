# Icon Files Required

You need to create three icon files for the Chrome extension:

- `icon16.png` - 16x16 pixels
- `icon48.png` - 48x48 pixels  
- `icon128.png` - 128x128 pixels

## Quick Solution

You can use any image editor or online tool to create these icons. Here are some options:

1. **Online Tools:**
   - [Favicon Generator](https://favicon.io/)
   - [Canva](https://www.canva.com/)
   - [Icon Generator](https://www.icoconverter.com/)

2. **Design Ideas:**
   - A highlighter pen icon
   - A note/document icon
   - A bookmark icon
   - Text with a highlight effect

3. **Temporary Placeholder:**
   - You can use any 16x16, 48x48, and 128x128 pixel images
   - The extension will work without proper icons, but Chrome will show a default icon

## Creating Icons with ImageMagick (if installed)

```bash
cd icons
convert -size 16x16 xc:#007AFF -pointsize 10 -fill white -gravity center -annotate +0+0 "WN" icon16.png
convert -size 48x48 xc:#007AFF -pointsize 30 -fill white -gravity center -annotate +0+0 "WN" icon48.png
convert -size 128x128 xc:#007AFF -pointsize 80 -fill white -gravity center -annotate +0+0 "WN" icon128.png
```

## Creating Icons with Python (PIL/Pillow)

```python
from PIL import Image, ImageDraw, ImageFont

sizes = [16, 48, 128]
for size in sizes:
    img = Image.new('RGB', (size, size), color='#007AFF')
    draw = ImageDraw.Draw(img)
    # Add text or shapes here
    img.save(f'icon{size}.png')
```

For now, you can use any placeholder images or create simple colored squares.

