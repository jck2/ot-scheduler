import { useCallback, useState, type DragEvent } from 'react';

interface FileDropZoneProps {
  label: string;
  accept: string;
  onFile: (file: File) => void;
  fileName?: string;
}

export function FileDropZone({ label, accept, onFile, fileName }: FileDropZoneProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) onFile(file);
    },
    [onFile]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFile(file);
    },
    [onFile]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
        dragOver
          ? 'border-indigo-400 bg-indigo-50'
          : fileName
            ? 'border-green-300 bg-green-50'
            : 'border-gray-300 hover:border-indigo-300 hover:bg-gray-50'
      }`}
    >
      <label className="cursor-pointer block">
        <input
          type="file"
          accept={accept}
          onChange={handleChange}
          className="hidden"
        />
        {fileName ? (
          <div>
            <p className="text-green-700 font-medium">{fileName}</p>
            <p className="text-sm text-gray-500 mt-1">Click or drag to replace</p>
          </div>
        ) : (
          <div>
            <p className="text-gray-600 font-medium">{label}</p>
            <p className="text-sm text-gray-400 mt-1">Drag & drop or click to browse</p>
          </div>
        )}
      </label>
    </div>
  );
}
