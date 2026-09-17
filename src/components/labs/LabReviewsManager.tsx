import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Star, Plus, Trash2, MessageSquare, ShieldAlert } from 'lucide-react';

interface LabReviewsManagerProps {
  labId: string;
}

export const LabReviewsManager: React.FC<LabReviewsManagerProps> = ({ labId }) => {
  const { labReviews, addLabReview, deleteLabReview, user } = useApp();
  const reviews = labReviews.filter((r) => r.lab_id === labId);

  const [showAddForm, setShowAddForm] = useState(false);
  const [rating, setRating] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [reviewText, setReviewText] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [reviewerName, setReviewerName] = useState(user ? user.name : 'QC Specialist');
  const [errorMsg, setErrorMsg] = useState('');

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (rating < 1 || rating > 5) {
      setErrorMsg('Please select a star rating between 1 and 5');
      return;
    }
    if (reviewText && reviewText.length > 1000) {
      setErrorMsg('Review text cannot exceed 1000 characters');
      return;
    }

    addLabReview({
      lab_id: labId,
      rating,
      review_text: reviewText.trim(),
      reviewer_name: reviewerName.trim() || 'QC Specialist',
      case_number: caseNumber.trim() || undefined
    });

    setReviewText('');
    setCaseNumber('');
    setShowAddForm(false);
    setErrorMsg('');
  };

  const renderStars = (starCount: number, interactive = false) => {
    return (
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            type="button"
            key={s}
            disabled={!interactive}
            onClick={() => interactive && setRating(s)}
            onMouseEnter={() => interactive && setHoverRating(s)}
            onMouseLeave={() => interactive && setHoverRating(0)}
            className={`${interactive ? 'cursor-pointer p-0.5' : 'cursor-default'}`}
          >
            <Star
              className={`w-4 h-4 ${
                s <= (hoverRating || starCount)
                  ? 'text-amber-400 fill-amber-400'
                  : 'text-slate-300'
              }`}
            />
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-500 fill-amber-500" /> Lab Quality Performance Reviews ({reviews.length})
          </h3>
          <p className="text-xs text-slate-500">
            Internal QC audit feedback, margin fit evaluations, and turnaround scorecards
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-3 py-1 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 flex items-center gap-1 shadow-xs"
        >
          <Plus className="w-3.5 h-3.5" /> Post QC Review
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleAddSubmit} className="p-4 bg-amber-50/50 border border-amber-200 rounded-xl space-y-3">
          <h4 className="text-xs font-bold text-amber-900 uppercase">Post Quality Performance Rating</h4>

          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-700">Star Rating:</span>
            {renderStars(rating, true)}
            <span className="text-xs font-bold text-amber-600">{rating} / 5 Stars</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Reviewer Name</label>
              <input
                type="text"
                value={reviewerName}
                onChange={(e) => setReviewerName(e.target.value)}
                className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Linked Case # (Optional)</label>
              <input
                type="text"
                value={caseNumber}
                onChange={(e) => setCaseNumber(e.target.value)}
                placeholder="DS-0001"
                className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Review & Feedback Comments</label>
            <textarea
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="e.g. Excellent crown margin seal and precise contacts. Fast 2-day turnaround..."
              className="w-full p-2.5 text-xs bg-white border border-slate-200 rounded-lg resize-none"
            />
          </div>
          {errorMsg && <p className="text-xs text-rose-500 font-medium">{errorMsg}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="submit"
              className="px-4 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-lg shadow-xs"
            >
              Submit Review
            </button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {reviews.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
            No reviews posted for this lab yet.
          </div>
        ) : (
          reviews.map((r) => (
            <div key={r.id} className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {renderStars(r.rating)}
                  <span className="font-bold text-xs text-slate-900">{r.reviewer_name}</span>
                  {r.case_number && (
                    <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-[10px] font-bold rounded">
                      Case: {r.case_number}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400">{r.created_at}</span>
                  <button
                    onClick={() => {
                      if (confirm('Delete this review?')) deleteLabReview(r.id);
                    }}
                    className="p-1 text-slate-400 hover:text-rose-600 rounded"
                    title="Delete Review"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {r.review_text && <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{r.review_text}</p>}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
