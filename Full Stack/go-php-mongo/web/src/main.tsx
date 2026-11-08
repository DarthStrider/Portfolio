import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "./api/client";
import { AuthProvider } from "./auth/AuthProvider";
import { ShopLayout } from "./components/Layout";
import { Empty } from "./components/ui";
import { Catalog, ContentPage, Home } from "./pages/shop/Browse";
import { ProductView } from "./pages/shop/ProductView";
import { CartPage, Checkout, OrderView, Pay } from "./pages/shop/Checkout";
import { AccountPage, ForgotPassword, Login, Register, ResetPassword } from "./pages/account/Account";
import { AdminLayout, AdminOrder, AdminOrders, Coupons, Dashboard, Inventory, People } from "./pages/admin/Admin";
import { Categories, PageEdit, Pages, ProductEdit, Products, Reviews } from "./pages/admin/CatalogAdmin";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // A 404 or 403 won't fix itself; only retry network trouble and 5xx.
      retry: (count, err) => count < 2 && !(err instanceof ApiError && err.status < 500),
      refetchOnWindowFocus: false,
    },
  },
});

function NotFound() {
  return (
    <div className="wrap section">
      <Empty title="This trail doesn't go anywhere">
        <Link to="/" className="btn btn-primary">Back to the shop</Link>
      </Empty>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<ShopLayout />}>
              <Route index element={<Home />} />
              <Route path="shop" element={<Catalog />} />
              <Route path="shop/:category" element={<Catalog />} />
              <Route path="products/:slug" element={<ProductView />} />
              <Route path="cart" element={<CartPage />} />
              <Route path="checkout" element={<Checkout />} />
              <Route path="checkout/pay/:orderId" element={<Pay />} />
              <Route path="orders/:orderId" element={<OrderView />} />
              <Route path="pages/:slug" element={<ContentPage />} />
              <Route path="login" element={<Login />} />
              <Route path="register" element={<Register />} />
              <Route path="forgot-password" element={<ForgotPassword />} />
              <Route path="reset-password" element={<ResetPassword />} />
              <Route path="account" element={<AccountPage />} />
              <Route path="*" element={<NotFound />} />
            </Route>
            <Route path="admin" element={<AdminLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="orders" element={<AdminOrders />} />
              <Route path="orders/:id" element={<AdminOrder />} />
              <Route path="products" element={<Products />} />
              <Route path="products/new" element={<ProductEdit />} />
              <Route path="products/:id" element={<ProductEdit key="edit" />} />
              <Route path="inventory" element={<Inventory />} />
              <Route path="categories" element={<Categories />} />
              <Route path="reviews" element={<Reviews />} />
              <Route path="pages" element={<Pages />} />
              <Route path="pages/:slug" element={<PageEdit />} />
              <Route path="coupons" element={<Coupons />} />
              <Route path="users" element={<People />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
