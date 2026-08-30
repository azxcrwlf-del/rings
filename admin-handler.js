/**
 * Admin Image Upload Handler
 * Handles R2 upload + products.json update WITHOUT page refresh
 */

class AdminUploadManager {
  constructor() {
    this.isUploading = false;
    this.uploadQueue = [];
  }

  /**
   * Upload image to R2 and get URL
   * @param {File} file - Image file to upload
   * @param {string} productId - Product ID
   * @returns {Promise<string>} R2 URL
   */
  async uploadImageToR2(file, productId) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('productId', productId);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const data = await response.json();
      return data.url; // Return R2 URL
    } catch (error) {
      console.error('R2 upload error:', error);
      throw error;
    }
  }

  /**
   * Update product with new image URL (in memory + backend)
   * @param {string} productId - Product ID
   * @param {string} imageUrl - New R2 URL
   */
  async addImageToProduct(productId, imageUrl) {
    try {
      // Update backend
      const response = await fetch('/api/products/' + productId + '/add-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl }),
      });

      if (!response.ok) throw new Error('Failed to add image to product');

      const updated = await response.json();
      return updated;
    } catch (error) {
      console.error('Failed to add image to product:', error);
      throw error;
    }
  }

  /**
   * Remove image from product
   * @param {string} productId - Product ID
   * @param {string} imageUrl - Image URL to remove
   */
  async removeImageFromProduct(productId, imageUrl) {
    try {
      const response = await fetch(
        '/api/products/' + productId + '/remove-image',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl }),
        }
      );

      if (!response.ok) throw new Error('Failed to remove image');

      const updated = await response.json();
      return updated;
    } catch (error) {
      console.error('Failed to remove image:', error);
      throw error;
    }
  }

  /**
   * Deploy products.json WITHOUT closing admin modal
   */
  async deployWithoutRefresh() {
    try {
      const statusEl = document.getElementById('publishStatus');
      if (statusEl) {
        statusEl.textContent = 'جاري النشر...';
        statusEl.classList.remove('ok', 'error');
      }

      const response = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) throw new Error('Publish failed');

      if (statusEl) {
        statusEl.textContent = '✓ تم النشر بنجاح';
        statusEl.classList.add('ok');
      }

      // Reload product data in the current admin view
      await this.refreshAdminUI();

      return true;
    } catch (error) {
      console.error('Deploy error:', error);
      if (document.getElementById('publishStatus')) {
        document.getElementById('publishStatus').textContent =
          '✗ خطأ في النشر: ' + error.message;
        document.getElementById('publishStatus').classList.add('error');
      }
      return false;
    }
  }

  /**
   * Refresh admin UI with latest product data
   * WITHOUT closing the modal
   */
  async refreshAdminUI() {
    try {
      // Fetch latest products.json
      const response = await fetch('/api/products');
      if (!response.ok) throw new Error('Failed to fetch products');

      const data = await response.json();
      window.productsData = data; // Update global products data

      // Re-render admin list without closing modal
      this.updateAdminProductsList();
    } catch (error) {
      console.error('Failed to refresh UI:', error);
    }
  }

  /**
   * Update admin products list in DOM
   */
  updateAdminProductsList() {
    const adminList = document.querySelector('.admin-list');
    if (!adminList || !window.productsData) return;

    // Rebuild list with current products
    adminList.innerHTML = window.productsData.products
      .map((product) => this.renderAdminItem(product))
      .join('');

    // Re-attach event listeners
    this.attachAdminListeners();
  }

  /**
   * Render single admin product item
   */
  renderAdminItem(product) {
    const thumb = product.images?.[0] || '';
    return `
      <div class="admin-item" data-product-id="${product.id}">
        <img src="${thumb}" class="admin-thumb" alt="${product.name}" />
        <div class="admin-item-info">
          ${product.name}
          <span>${product.price} ريال</span>
        </div>
        <div class="admin-item-actions">
          <button class="edit-btn">تعديل</button>
          <button class="delete-btn danger">حذف</button>
        </div>
      </div>
    `;
  }

  /**
   * Attach event listeners to admin controls
   */
  attachAdminListeners() {
    document.querySelectorAll('.admin-item .edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.openProductEditor(btn));
    });

    document.querySelectorAll('.admin-item .delete-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.deleteProduct(btn));
    });
  }

  /**
   * Open product editor (keeps admin modal open)
   */
  openProductEditor(btn) {
    const item = btn.closest('.admin-item');
    const productId = item.dataset.productId;
    // TODO: Implement product edit flow
    console.log('Edit product:', productId);
  }

  /**
   * Delete product
   */
  async deleteProduct(btn) {
    const item = btn.closest('.admin-item');
    const productId = item.dataset.productId;

    if (confirm('هل أنت متأكد من حذف هذا المنتج؟')) {
      try {
        const response = await fetch('/api/products/' + productId, {
          method: 'DELETE',
        });

        if (!response.ok) throw new Error('Delete failed');

        item.remove();
        await this.deployWithoutRefresh();
      } catch (error) {
        alert('فشل الحذف: ' + error.message);
      }
    }
  }
}

// Initialize on page load
const uploadManager = new AdminUploadManager();
