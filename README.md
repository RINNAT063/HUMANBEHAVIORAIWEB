# HUMANBEHAVIORAIWEB
<!DOCTYPE HTML>
<html>
  <head>
    <meta charset="utf-8">
  </head>
  <body>
    <h1> NHÓM 03 - HỆ ĐIỀU HÀNH 2026.2027 - 	2611COMP133202</h1>
    <ol>
      <li>Huỳnh Trần Gia Huy - 50.01.103.025</li>
      <li>Thạch Võ Diễm Ngọc - 50.01.103.050</li>
      <li>Trần Ánh Ngọc - 50.01.103.051 - (Nhóm trưởng)</li>
      <li>Phùng Thị Mỹ Quyên - 50.01.103.063</li>
      <li>Lê Nguyễn Thuỳ Trâm - 50.01.103.076</li>
   </body>
</html>
      
  ## HƯỚNG DẪN CÀI ĐẶT VÀ SỬ DỤNG HUMANBEHAVIORAI
### Yêu cầu môi trường
- Hệ điều hành Windows.
- Trình biên dịch C++ hỗ trợ C++20.
- CMake phiên bản 3.16 trở lên.
- MSYS2 UCRT64.
- Các thư viện Crow, CPR, OpenSSL và libpqxx.
- PostgreSQL để phục vụ chức năng lưu trữ dữ liệu.
- Trình duyệt web như Google Chrome hoặc Microsoft Edge.
### Biên dịch backend bằng CMake:
```bash
cmake -S backend -B backend/build
cmake --build backend/build
```
### Khởi động hệ thống
Sau khi biên dịch thành công:
1. Khởi động dịch vụ PostgreSQL.
2. Chạy chương trình backend đã biên dịch.
3. Kiểm tra thông báo khởi động server trong Terminal.
4. Mở giao diện frontend theo cách triển khai của dự án.
5. Bảo đảm frontend có thể kết nối đến backend.
### 6. Hướng dẫn sử dụng website
**Bước 1. Truy cập giao diện**
Mở trang web HumanBehaviorAI bằng trình duyệt.
Có thể vào thẳng trang phân tích, file analyze.html để thực hiện phân tích video
**Bước 2. Tải video lên**
- Chọn chức năng tải video.
- Chọn video từ thiết bị.
- Sử dụng video ngắn.
- Gửi video để bắt đầu phân tích.
**Bước 3. Chờ hệ thống xử lý**
**Bước 4. Xem kết quả**
- Nội dung tóm tắt video.
- Danh sách người xuất hiện.
- Thời điểm xuất hiện và đặc điểm mô tả.
- Các hành động được phát hiện và khoảng thời gian tương ứng.
- Biểu đồ thống kê thời lượng hành vi.
**Bước 5. Theo dõi hệ thống**
Sử dụng các chức năng thống kê được cung cấp trên giao diện hoặc vào các tab monitor để xem thông tin xử lý và tài nguyên hệ thống.
