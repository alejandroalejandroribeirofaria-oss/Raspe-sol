export default function ImageLightbox({ src, onClose }) {
  if (!src) return null;

  return (
    <div className="lightbox" onClick={onClose}>
      <button
        className="lightbox__close"
        onClick={onClose}
        aria-label="Close"
      >
        ×
      </button>

      <img
        src={src}
        alt=""
        className="lightbox__image"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
