import { useState } from "react"
import PayPalCheckoutButton from "../components/PayPalCheckoutButton"
import { verifyPayPalPayment } from "../api/payments"





export default function PayTestPage() {
    const [status, setStatus] = useState<"idle" | "success" | "error">("idle")
    const [message, setMessage] = useState<string>("")
    const [orderId, setOrderId] = useState<string>("")

    return (
        <div className="card stack12">
            <h2 className="h2">Тест PayPal (MVP)</h2>

            <div style={{ fontSize: 14, color: "#6b7280" }}>
                Це тестова оплата. Поки що вона не активує просування — ми лише перевіряємо,
                що PayPal працює у твоєму React-додатку.
            </div>

            <div className="card stack8">
                <strong>Сума:</strong> 5.00 PLN
                <div style={{ fontSize: 13, color: "#6b7280" }}>
                    (потім підставимо реальні ціни для TOP / Featured / Gold)
                </div>
            </div>

            {status === "success" && (
                <div className="card" style={{ border: "1px solid #16a34a" }}>
                    <strong style={{ color: "#16a34a" }}>Оплата успішна</strong>
                    {orderId && (
                        <div style={{ marginTop: 6, fontSize: 13 }}>
                            Order ID: <code>{orderId}</code>
                        </div>
                    )}
                </div>
            )}

            {status === "error" && (
                <div className="card" style={{ border: "1px solid #b91c1c" }}>
                    <strong style={{ color: "#b91c1c" }}>Помилка</strong>
                    <div style={{ marginTop: 6, fontSize: 13 }}>{message}</div>
                </div>
            )}

            <PayPalCheckoutButton
                amountPLN={5}
                description="Ozen Board — test payment"
                onSuccess={async (id) => {
                    try {
                        setOrderId(id)

                        const result = await verifyPayPalPayment({
                            orderId: id,
                            targetType: "ad",
                            targetId: "TEST_ONLY",
                            promotionType: "test",
                        })

                        if (result.data?.ok) {
                            setStatus("success")
                            setMessage("verifyPayPalPayment OK")
                        } else {
                            setStatus("error")
                            setMessage("verifyPayPalPayment повернув помилку")
                        }
                    } catch (e) {
                        console.error(e)
                        setStatus("error")
                        setMessage("Помилка виклику verifyPayPalPayment")
                    }
                }}

                onError={(msg) => {
                    setStatus("error")
                    setMessage(msg)
                }}
            />
        </div>
    )
}
