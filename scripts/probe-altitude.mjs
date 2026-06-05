// Throwaway probe: extract altitude data from full-res drone JPGs.
// Reads standard EXIF GPS altitude (via sharp + exif-reader) AND the DJI XMP
// packet (drone-dji:RelativeAltitude / AbsoluteAltitude / GpsAltitude) which
// exif-reader does not parse. Usage: node scripts/probe-altitude.mjs <file...>
import sharp from 'sharp'
import exifReader from 'exif-reader'
import { readFile } from 'node:fs/promises'

const XMP_FIELDS = [
  'RelativeAltitude',
  'AbsoluteAltitude',
  'GpsLatitude',
  'GpsLongitude',
  'GpsLongtitude', // DJI typo seen in some firmware
  'FlightYawDegree',
  'GimbalPitchDegree',
]

function pullXmp(buf) {
  // XMP is an ASCII XML packet embedded in an APP1 segment. Scan as latin1.
  const s = buf.toString('latin1')
  const start = s.indexOf('<x:xmpmeta')
  const end = s.indexOf('</x:xmpmeta>')
  const xmp = start !== -1 && end !== -1 ? s.slice(start, end + 12) : s
  const out = {}
  for (const f of XMP_FIELDS) {
    // matches both attribute form  drone-dji:RelativeAltitude="+47.20"
    // and element form <drone-dji:RelativeAltitude>+47.20</...>
    const attr = new RegExp(`drone-dji:${f}\\s*=\\s*"([^"]*)"`).exec(xmp)
    const elem = new RegExp(`<drone-dji:${f}>([^<]*)<`).exec(xmp)
    const m = attr || elem
    if (m) out[f] = m[1].trim()
  }
  return out
}

function fmtGpsAlt(gps) {
  if (!gps || gps.GPSAltitude == null) return null
  const ref = gps.GPSAltitudeRef // 0 = above sea level, 1 = below
  const sign = ref === 1 ? -1 : 1
  return sign * gps.GPSAltitude
}

for (const file of process.argv.slice(2)) {
  console.log('\n=== ' + file)
  try {
    const buf = await readFile(file)
    let exif = null
    try {
      const meta = await sharp(buf).metadata()
      if (meta.exif) exif = exifReader(meta.exif)
    } catch (e) {
      console.log('  (sharp/exif failed: ' + e.message + ')')
    }
    const gps = exif?.GPSInfo || exif?.gps
    const make = exif?.Image?.Make || exif?.image?.Make
    const model = exif?.Image?.Model || exif?.image?.Model
    const date = exif?.Photo?.DateTimeOriginal || exif?.exif?.DateTimeOriginal
    console.log('  camera        :', [make, model].filter(Boolean).join(' ') || '(unknown)')
    console.log('  date taken    :', date || '(none)')
    console.log('  EXIF GPS alt  :', fmtGpsAlt(gps) != null ? fmtGpsAlt(gps).toFixed(1) + ' m (above sea level)' : '(none)')
    if (gps?.GPSLatitude) {
      console.log('  EXIF GPS lat/lon:', JSON.stringify(gps.GPSLatitude), gps.GPSLatitudeRef, '/', JSON.stringify(gps.GPSLongitude), gps.GPSLongitudeRef)
    }
    const xmp = pullXmp(buf)
    if (Object.keys(xmp).length) {
      console.log('  --- DJI XMP ---')
      for (const [k, v] of Object.entries(xmp)) console.log('  ' + k.padEnd(16) + ':', v)
    } else {
      console.log('  --- DJI XMP --- : (none found)')
    }
  } catch (e) {
    console.log('  ERROR:', e.message)
  }
}
