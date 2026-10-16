// Verkleint een telefoonfoto tot max. 1600px aan de lange kant als JPEG.
// Scheelt upload-tijd, opslag en API-kosten; het label blijft goed leesbaar.
export async function shrinkImage(file, maxSide = 1600, quality = 0.82) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  const blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('Foto kon niet worden verwerkt'))), 'image/jpeg', quality),
  )
  return blob
}

export async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(bin)
}
