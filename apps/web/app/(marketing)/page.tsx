import { LandingPage } from "@/app/(marketing)/_components/landing/landing-page";

export const metadata = {
  title: { absolute: "Kinfolk - Roommates and a place you can afford together" },
  description:
    "Kinfolk matches renters with compatible roommate groups and apartments they can actually afford together.",
};

export default function Home() {
  return <LandingPage />;
}
