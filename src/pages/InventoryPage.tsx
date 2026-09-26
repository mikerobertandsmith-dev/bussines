import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  ImagePlus,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import {
  Badge,
  Card,
  CardHead,
  EmptyState,
  Field,
  Segmented,
  Stat,
  btnGhost,
  btnPrimary,
  inputClass,
} from "../components/primitives";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { money } from "../lib/format";
import { useWorkspace, useWorkspaceData, type InventoryItemInput } from "../lib/workspace";
import type { InventoryItem } from "../lib/types";

type KindFilter = "all" | "product" | "service";

const EMPTY_FORM: InventoryItemInput & { id?: string } = {
  kind: "product",
  name: "",
  sku: "",
  category: "",
  description: "",
  price: 0,
  compareAtPrice: 0,
  stock: 0,
  status: "active",
  imageUrl: "",
  tags: [],
};

const STATUS_TONE = { active: "good", draft: "warn", archived: "neutral" } as const;

export function InventoryPage() {
  const toast = useToast();
  const workspace = useWorkspaceData();
  const { actions } = useWorkspace();
  const items = workspace.inventory;

  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [tagText, setTagText] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items
      .filter((i) => (kindFilter === "all" ? true : i.kind === kindFilter))
      .filter((i) =>
        term === ""
          ? true
          : `${i.name} ${i.sku} ${i.category} ${i.tags.join(" ")}`.toLowerCase().includes(term),
      );
  }, [items, kindFilter, search]);

  const stats = useMemo(() => {
    const products = items.filter((i) => i.kind === "product");
    return {
      total: items.length,
      products: products.length,
      services: items.filter((i) => i.kind === "service").length,
      lowStock: products.filter((i) => i.stock > 0 && i.stock <= 20).length,
    };
  }, [items]);

  function openNew(kind: InventoryItem["kind"]) {
    setForm({ ...EMPTY_FORM, kind });
    setTagText("");
    setFormOpen(true);
  }

  function openEdit(item: InventoryItem) {
    setForm({
      id: item.id,
      kind: item.kind,
      name: item.name,
      sku: item.sku,
      category: item.category,
      description: item.description,
      price: item.price,
      compareAtPrice: item.compareAtPrice,
      stock: item.stock,
      status: item.status,
      imageUrl: item.imageUrl,
      tags: item.tags,
    });
    setTagText(item.tags.join(", "));
    setFormOpen(true);
  }

  async function pickImage(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const url = await actions.uploadInventoryImage(file);
      setForm((prev) => ({ ...prev, imageUrl: url }));
      toast("Image added to this item.");
    } catch {
      toast("Could not read that image — try a PNG or JPG.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function save() {
    if (!form.name.trim()) {
      toast("Give the product or service a name.");
      return;
    }
    const tags = tagText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    void actions.saveInventoryItem({
      ...form,
      name: form.name.trim(),
      sku: form.sku.trim(),
      category: form.category.trim(),
      description: form.description.trim(),
      tags,
      stock: form.kind === "service" ? 0 : form.stock,
    });
    toast(form.id ? `${form.name.trim()} updated.` : `${form.name.trim()} added to your catalogue.`);
    setFormOpen(false);
  }

  function remove(item: InventoryItem) {
    void actions.removeInventoryItem(item.id);
    toast(`${item.name} removed from your catalogue.`);
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Catalogue size" value={stats.total} icon={<Boxes size={16} />} hint="products & services" />
        <Stat label="Products" value={stats.products} icon={<Package size={16} />} hint="stock-tracked" />
        <Stat label="Services" value={stats.services} icon={<Wrench size={16} />} hint="bookable offerings" />
        <Stat
          label="Low stock"
          value={stats.lowStock}
          icon={<AlertTriangle size={16} />}
          hint="20 units or fewer"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <button type="button" className={btnPrimary} onClick={() => openNew("product")}>
          <Plus size={14} /> Add product
        </button>
        <button type="button" className={btnGhost} onClick={() => openNew("service")}>
          <Wrench size={14} /> Add service
        </button>
        <div className="relative ml-auto">
          <Search size={14} className="absolute top-2.5 left-2.5 text-slate-400" />
          <input
            className={`${inputClass} pl-8`}
            placeholder="Search name, SKU or tag"
            aria-label="Search catalogue"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <Card>
        <CardHead
          icon={<Boxes size={16} />}
          title="Products & services"
          subtitle="The catalogue your promotion designs draw from"
          action={
            <Segmented
              size="sm"
              value={kindFilter}
              onChange={setKindFilter}
              options={[
                { value: "all", label: "All" },
                { value: "product", label: "Products" },
                { value: "service", label: "Services" },
              ]}
            />
          }
        />

        {visible.length === 0 ? (
          <EmptyState
            title={items.length === 0 ? "Nothing in your catalogue yet" : "Nothing matches that filter"}
            hint={
              items.length === 0
                ? "Add your first product or service to start creating ad designs."
                : "Try another search term or switch the filter."
            }
          />
        ) : (
          <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((item) => {
              const discounted = item.compareAtPrice > item.price;
              return (
                <div
                  key={item.id}
                  className="flex flex-col overflow-hidden rounded-xl border border-slate-200"
                >
                  <div className="relative h-40 w-full bg-slate-100">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-1 text-slate-400">
                        {item.kind === "service" ? <Wrench size={26} /> : <ImagePlus size={26} />}
                        <span className="text-[11px]">
                          {item.kind === "service" ? "No image yet" : "Add a product image"}
                        </span>
                      </div>
                    )}
                    <span className="absolute top-2 left-2">
                      <Badge tone={item.kind === "service" ? "info" : "brand"}>
                        {item.kind === "service" ? "Service" : "Product"}
                      </Badge>
                    </span>
                    <span className="absolute top-2 right-2">
                      <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
                    </span>
                  </div>

                  <div className="flex flex-1 flex-col p-3">
                    <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {item.category || "Uncategorised"}
                      {item.sku ? ` · ${item.sku}` : ""}
                    </p>

                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="text-base font-semibold text-slate-900">
                        {money(item.price)}
                      </span>
                      {discounted ? (
                        <span className="text-xs text-slate-400 line-through">
                          {money(item.compareAtPrice)}
                        </span>
                      ) : null}
                    </div>

                    {item.description ? (
                      <p className="mt-2 line-clamp-2 text-[11px] text-slate-600">
                        {item.description}
                      </p>
                    ) : null}

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {item.kind === "product" ? (
                        <Badge
                          tone={item.stock === 0 ? "bad" : item.stock <= 20 ? "warn" : "neutral"}
                        >
                          {item.stock === 0 ? "Out of stock" : `${item.stock} in stock`}
                        </Badge>
                      ) : (
                        <Badge tone="neutral">Bookable</Badge>
                      )}
                      {item.tags.map((t) => (
                        <Badge key={t} tone="neutral">
                          {t}
                        </Badge>
                      ))}
                    </div>

                    <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
                      <button type="button" className={btnGhost} onClick={() => openEdit(item)}>
                        <Pencil size={13} /> Edit
                      </button>
                      <button
                        type="button"
                        className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-rose-600 hover:underline"
                        onClick={() => remove(item)}
                      >
                        <Trash2 size={13} /> Remove
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={form.id ? `Edit ${form.name || "item"}` : form.kind === "service" ? "Add a service" : "Add a product"}
        subtitle="Anything you save here can be used in your promotion designs"
        icon={form.kind === "service" ? <Wrench size={16} /> : <Package size={16} />}
        width="lg"
        footer={
          <>
            <button type="button" className={btnGhost} onClick={() => setFormOpen(false)}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} onClick={save}>
              {form.id ? "Save changes" : "Add to catalogue"}
            </button>
          </>
        }
      >
        <div className="space-y-3 px-4 py-4">
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-600">Type</p>
            <Segmented
              size="sm"
              value={form.kind}
              onChange={(kind) => setForm({ ...form, kind })}
              options={[
                { value: "product", label: "Product" },
                { value: "service", label: "Service" },
              ]}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={form.kind === "service" ? "Service name" : "Product name"}>
              <input
                className={inputClass}
                placeholder={form.kind === "service" ? "e.g. In-store consultation" : "e.g. Velvet Lip Kit"}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Category">
              <input
                className={inputClass}
                placeholder="e.g. Beauty & cosmetics"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Price">
              <input
                type="number"
                min={0}
                className={inputClass}
                value={form.price}
                onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
              />
            </Field>
            <Field label="Was (for discounts)" hint="Leave 0 when not on offer">
              <input
                type="number"
                min={0}
                className={inputClass}
                value={form.compareAtPrice}
                onChange={(e) => setForm({ ...form, compareAtPrice: Number(e.target.value) })}
              />
            </Field>
            {form.kind === "product" ? (
              <Field label="Stock on hand">
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })}
                />
              </Field>
            ) : (
              <Field label="SKU (optional)">
                <input
                  className={inputClass}
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                />
              </Field>
            )}
          </div>

          {form.kind === "product" ? (
            <Field label="SKU">
              <input
                className={inputClass}
                placeholder="e.g. LUM-LK-1200"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />
            </Field>
          ) : null}

          <Field label="Description" hint="Used as ad copy you can edit on the Promotions page">
            <textarea
              className={`${inputClass} h-20 resize-none`}
              placeholder="What it is, key specs, sizes or what the service includes"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>

          <Field label="Tags" hint="Comma separated, e.g. best seller, free delivery">
            <input
              className={inputClass}
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
            />
          </Field>

          <Field label="Status">
            <Segmented
              size="sm"
              value={form.status}
              onChange={(status) => setForm({ ...form, status })}
              options={[
                { value: "active", label: "Active" },
                { value: "draft", label: "Draft" },
                { value: "archived", label: "Archived" },
              ]}
            />
          </Field>

          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-600">Item image</p>
            <div className="flex items-center gap-3">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                {form.imageUrl ? (
                  <img src={form.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImagePlus size={20} className="text-slate-400" />
                )}
              </div>
              <div className="flex flex-col gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void pickImage(e.target.files?.[0])}
                />
                <button
                  type="button"
                  className={btnGhost}
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  <ImagePlus size={14} /> {uploading ? "Uploading…" : form.imageUrl ? "Replace image" : "Upload image"}
                </button>
                {form.imageUrl ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 hover:underline"
                    onClick={() => setForm({ ...form, imageUrl: "" })}
                  >
                    <X size={13} /> Remove image
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
