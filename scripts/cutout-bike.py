"""Extract supplied bicycle without repainting its original RGB pixels.

The source has a white studio background and a gray horizon. Geometric masks
protect the white frame; luminance matting preserves fine wheel/spoke detail.
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

source = Path('C:/Users/老涂/Desktop/01.webp')
target = Path('public/youbike-cutout.png')
im = Image.open(source).convert('RGB')
rgb = np.asarray(im).astype(float)
size = im.size
silhouette = Image.new('L', size)
d = ImageDraw.Draw(silhouette)
# Wheels, orange rear body, saddle, main frame, front assembly and basket.
d.ellipse((134, 130, 290, 286), fill=255)
d.ellipse((406, 133, 567, 286), fill=255)
for polygon in [
 [(137,157),(150,135),(150,96),(228,96),(262,121),(277,190),(313,209),(318,234),(199,225),(172,181)],
 [(232,54),(269,49),(309,50),(309,62),(266,74),(254,81),(239,76)],
 [(245,67),(260,68),(280,167),(323,218),(355,220),(397,187),(411,154),(434,73),(451,78),(425,170),(408,203),(371,233),(327,240),(285,237),(267,210)],
 [(402,24),(423,21),(445,36),(466,48),(466,103),(459,134),(490,210),(482,216),(445,140),(430,114),(429,81),(416,78),(415,45),(401,37)],
 [(447,25),(482,21),(510,24),(512,52),(507,83),(491,90),(458,87),(450,68)],
 [(199,220),(211,191),(276,158),(310,207),(321,218),(299,231)],
]: d.polygon(polygon, fill=255)
d.polygon([(138,158),(152,95),(235,94),(279,132),(284,113),(319,186),(360,188),(408,115),(420,88),(452,80),(469,130),(490,214),(347,239),(196,228)], fill=255)

# Matte neutral studio white to transparent, retaining dark spokes and colored
# parts. White painted frame segments receive a separate opaque interior mask.
alpha = np.clip((255 - rgb.min(axis=2)) / 36, 0, 1)
protect = Image.new('L', size)
p = ImageDraw.Draw(protect)
for polygon in [
 [(270,79),(274,78),(287,112),(284,114)],
 [(438,121),(451,132),(486,207),(482,210),(447,150)],
 [(416,62),(421,61),(433,89),(425,91)],
 [(222,209),(296,210),(299,215),(222,215)],
]: p.polygon(polygon, fill=255)
p.polygon([(281,116),(291,114),(319,188),(307,188)], fill=255)
p.polygon([(438,101),(447,115),(415,132),(375,194),(351,225),(341,226),(348,209),(365,183),(397,129),(415,110)], fill=255)
p.polygon([(280,126),(284,131),(219,202),(215,200)], fill=255)
p.polygon([(421,91),(431,89),(440,109),(430,116)], fill=255)
protect = np.asarray(protect.filter(ImageFilter.GaussianBlur(.6))) / 255
alpha = np.maximum(alpha, protect) * (np.asarray(silhouette) / 255)
yy, xx = np.indices(alpha.shape)
alpha[(yy>=221)&(yy<=230)&(rgb.min(axis=2)>218)&(protect<.1)] = 0
# Eliminate the source horizon crossing the open wheel interiors.
for cx, cy, radius in [(211,208,61),(486,210,64)]:
 yy, xx = np.indices(alpha.shape)
 interior = (xx-cx)**2 + (yy-cy)**2 < radius**2
 horizon = interior & (yy >= 221) & (yy <= 229) & (rgb.min(axis=2)>218) & (protect<.1)
 alpha[horizon] = 0
out = im.convert('RGBA')
out.putalpha(Image.fromarray(np.uint8(alpha*255)))
out = out.crop((125,15,577,292))
target.parent.mkdir(exist_ok=True)
out.save(target)
preview = Image.new('RGBA', out.size, '#fff1d8')
preview.alpha_composite(out)
Path('outputs').mkdir(exist_ok=True)
preview.convert('RGB').save('outputs/bike-preview.png')
print(f'{target}: {out.size}, alpha range {out.getchannel("A").getextrema()}')
