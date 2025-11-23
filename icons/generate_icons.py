#!/usr/bin/env python3
"""
Simple script to generate placeholder icons for the WebNotes Chrome extension.
Requires Pillow: pip install Pillow
"""

try:
    from PIL import Image, ImageDraw, ImageFont
    import os

    def create_icon(size, output_path):
        """Create a simple icon with a highlighter/note design"""
        # Create image with blue background
        img = Image.new('RGB', (size, size), color='#007AFF')
        draw = ImageDraw.Draw(img)
        
        # Draw a simple highlighter/note icon
        # Draw a rectangle (representing a note/highlight)
        margin = size // 6
        draw.rectangle(
            [margin, margin, size - margin, size - margin],
            fill='#FFD700',  # Yellow highlight color
            outline='white',
            width=max(1, size // 32)
        )
        
        # Draw lines to represent text
        line_spacing = size // 8
        for i in range(2, 5):
            y = margin + (line_spacing * i)
            if y < size - margin:
                draw.line(
                    [margin + size // 12, y, size - margin - size // 12, y],
                    fill='#333',
                    width=max(1, size // 64)
                )
        
        img.save(output_path)
        print(f"Created {output_path} ({size}x{size})")

    # Create icons directory if it doesn't exist
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Generate icons
    sizes = [16, 48, 128]
    for size in sizes:
        output_path = os.path.join(script_dir, f'icon{size}.png')
        create_icon(size, output_path)
    
    print("\n✓ All icons generated successfully!")
    print("You can now load the extension in Chrome.")

except ImportError:
    print("Pillow is not installed. Install it with: pip install Pillow")
    print("\nAlternatively, you can:")
    print("1. Use any image editor to create 16x16, 48x48, and 128x128 pixel icons")
    print("2. Name them icon16.png, icon48.png, and icon128.png")
    print("3. Place them in the icons/ directory")
except Exception as e:
    print(f"Error generating icons: {e}")
    print("\nYou can manually create the icons or use an online tool.")

