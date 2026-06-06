import { useParams } from 'react-router-dom';

export default function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  return (
    <div>
      <h2>Order #{orderId}</h2>
      <p>Order detail view — coming soon</p>
    </div>
  );
}
