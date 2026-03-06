import { useCallback, useRef, useState, type DragEvent } from 'react'

interface Props {
  onImageLoad: (image: HTMLImageElement) => void
}

export default function ImageUploader({ onImageLoad }: Props) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        onImageLoad(img)
        URL.revokeObjectURL(url)
      }
      img.src = url
    },
    [onImageLoad],
  )

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) processFile(file)
    },
    [processFile],
  )

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleClick = () => inputRef.current?.click()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  return (
    <div
      onClick={handleClick}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`
        group relative flex cursor-pointer flex-col items-center justify-center
        rounded-2xl border-2 border-dashed p-12 transition-all duration-300
        ${
          isDragging
            ? 'scale-[1.02] border-primary-400 bg-primary-50 shadow-lg shadow-primary-200/40'
            : 'border-gray-300 bg-white hover:border-primary-300 hover:bg-primary-50/50 hover:shadow-md'
        }
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <div
        className={`
          mb-4 flex h-16 w-16 items-center justify-center rounded-2xl transition-all duration-300
          ${isDragging ? 'bg-primary-100 text-primary-600' : 'bg-gray-100 text-gray-400 group-hover:bg-primary-100 group-hover:text-primary-500'}
        `}
      >
        <svg
          className="h-8 w-8"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>
      </div>

      <p className="text-base font-medium text-gray-600 transition-colors group-hover:text-primary-700">
        {isDragging ? '松开以上传图片' : '点击或拖拽图片到此处'}
      </p>
      <p className="mt-1.5 text-sm text-gray-400">
        支持 PNG、JPG、BMP、WebP 等常见格式
      </p>
    </div>
  )
}
