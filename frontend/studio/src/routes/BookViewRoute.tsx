import { useNavigate, useParams } from 'react-router-dom';
import { BookView } from '../book-view/BookView.js';

/**
 * The route mount for View Book — and the ONLY place that touches the router.
 * `BookView` itself takes its book as a prop so the same component can be an
 * overlay or a gate mount (design §1).
 */
export function BookViewRoute() {
  const { slug } = useParams();
  const navigate = useNavigate();
  if (!slug) return null;
  return <BookView slug={slug} onClose={() => navigate('/')} />;
}
