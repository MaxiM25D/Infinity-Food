import { ReservationBooking } from "@/components/reservations/reservation-booking";

export default async function ReservationsPage({ params }: { params: Promise<{ restaurantSlug: string; branchSlug: string }> }) {
  const { restaurantSlug, branchSlug } = await params;
  return <ReservationBooking branchSlug={branchSlug} restaurantSlug={restaurantSlug} />;
}
