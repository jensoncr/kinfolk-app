import { redirect } from "next/navigation";

export const metadata = {
  title: "Sign In",
};

export default function SignInPage() {
  redirect("/me");
}
